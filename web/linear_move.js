import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { $el } from "../../scripts/ui.js";
import { debug, _name, _endpoint, api_get, api_post } from "./utils.js";

// ===============================================
// MovementManager - 最適化されたノード移動拡張機能
// ===============================================
class MovementManager {
    constructor() {
        // 基本設定
        this.enableArrowMove = true;
        this.moveSteps = 100;
        this.moveStepsShift = 200;
        this.moveStepsCtrl = 10;

        // Shift+ドラッグ制限の状態
        this.shiftDragState = {
            active: false,
            startMouse: { x: 0, y: 0 },
            nodeStartPositions: new Map(),
            direction: null, // 'horizontal', 'vertical', null
            threshold: 10
        };
        
        // イベントハンドラーをバインド（一度だけ）
        this.boundHandlers = {
            keydown: this.handleKeyDown.bind(this),
            shiftKeyUp: this.handleShiftKeyUp.bind(this),
            pointerDown: this.handlePointerDown.bind(this),
            pointerMove: this.handlePointerMove.bind(this),
            pointerUp: this.handlePointerUp.bind(this)
        };
        
        this.isInitialized = false;
    }
    
    // ===============================================
    // 初期化とクリーンアップ
    // ===============================================
    initialize() {
        if (this.isInitialized) return;
        
        this.setupEventListeners();
        this.isInitialized = true;
    }
    
    cleanup() {
        if (!this.isInitialized) return;
        
        this.removeEventListeners();
        this.resetShiftDrag();
        this.isInitialized = false;
    }
    
    setupEventListeners() {
        // キーボードイベント
        document.addEventListener('keydown', this.boundHandlers.keydown, { capture: true, passive: false });
        document.addEventListener('keyup', this.boundHandlers.shiftKeyUp, { capture: true });
        
        // ポインターイベント（Shift+ドラッグ制限用）
        app.canvasEl.addEventListener('pointerdown', this.boundHandlers.pointerDown, { capture: true });
        app.canvasEl.addEventListener('pointermove', this.boundHandlers.pointerMove, { capture: true });
        app.canvasEl.addEventListener('pointerup', this.boundHandlers.pointerUp, { capture: true });
    }
    
    removeEventListeners() {
        document.removeEventListener('keydown', this.boundHandlers.keydown, { capture: true });
        document.removeEventListener('keyup', this.boundHandlers.shiftKeyUp, { capture: true });
        
        app.canvasEl.removeEventListener('pointerdown', this.boundHandlers.pointerDown, { capture: true });
        app.canvasEl.removeEventListener('pointermove', this.boundHandlers.pointerMove, { capture: true });
        app.canvasEl.removeEventListener('pointerup', this.boundHandlers.pointerUp, { capture: true });
    }
    
    // ===============================================
    // ユーティリティ関数
    // ===============================================
    canNodeMove() {
        const activeElement = document.activeElement;
        
        // 入力フィールドにフォーカスがある場合は無効
        const inputTags = ['INPUT', 'TEXTAREA'];
        if (inputTags.includes(activeElement?.tagName) || activeElement?.isContentEditable) {
            return false;
        }
        
        // 画像表示エリアでも、ノードが選択されていれば移動を許可
        const imageClasses = ['comfy-image', 'image-preview'];
        const imageTags = ['CANVAS', 'IMG'];
        if (imageClasses.some(cls => activeElement?.classList?.contains(cls)) || 
            imageTags.includes(activeElement?.tagName)) {
            return this.getSelectedNodes().length > 0;
        }

        return true;
    }

    getSelectedNodes() {
        const selectedNodes = app.canvas.selected_nodes;
        return typeof selectedNodes === "object" ? Object.values(selectedNodes) : [];
    }
    
    moveNodes(dx, dy) {
        const nodes = this.getSelectedNodes();
        if (nodes.length === 0) return false;
        
        // ノード移動
        nodes.forEach(node => {
            node.pos[0] += dx;
            node.pos[1] += dy;
        });
        
        // 選択オーバーレイも同期
        this.updateSelectionOverlay(dx, dy);
        
        // キャンバス更新
        app.canvas.setDirty(true, true);
        return true;
    }
    
    // ===============================================
    // キーボード移動機能
    // ===============================================
    handleKeyDown(e) {
        const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        
        // 早期リターン条件をまとめて処理
        if (!arrowKeys.includes(e.key) || 
            !this.enableArrowMove || 
            !this.canNodeMove() || 
            this.getSelectedNodes().length === 0) {
            return;
        }
        
        // イベント停止
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // 移動量の決定
        let step = this.moveSteps;
        if (e.shiftKey) step = this.moveStepsShift;
        else if (e.ctrlKey || e.metaKey) step = this.moveStepsCtrl;

        // 方向別の移動処理
        const movements = {
            'ArrowUp': [0, -step],
            'ArrowDown': [0, step],
            'ArrowLeft': [-step, 0],
            'ArrowRight': [step, 0]
        };
        
        const [dx, dy] = movements[e.key];
        this.moveNodes(dx, dy);
    }
    
    handleShiftKeyUp(e) {
        if (e.key === 'Shift' && this.shiftDragState.active) {
            this.endShiftDrag();
        }
    }
    
    // ===============================================
    // Shift+ドラッグ制限機能
    // ===============================================
    handlePointerDown(e) {
        if (e.shiftKey && this.getSelectedNodes().length > 0) {
            this.startShiftDrag(e);
        }
    }
    
    handlePointerMove(e) {
        if (this.shiftDragState.active) {
            this.processShiftDrag(e);
        }
    }
    
    handlePointerUp(e) {
        if (this.shiftDragState.active) {
            this.endShiftDrag();
        }
    }
    
    startShiftDrag(e) {
        const state = this.shiftDragState;
        const selectedNodes = this.getSelectedNodes();
        
        state.active = true;
        state.direction = null;
        state.startMouse = { x: e.clientX, y: e.clientY };
        
        // 開始位置を記録
        state.nodeStartPositions.clear();
        selectedNodes.forEach(node => {
            state.nodeStartPositions.set(node, { x: node.pos[0], y: node.pos[1] });
        });
    }
    
    processShiftDrag(e) {
        const state = this.shiftDragState;
        const deltaX = e.clientX - state.startMouse.x;
        const deltaY = e.clientY - state.startMouse.y;
        
        // 方向決定（初回のみ）
        if (!state.direction) {
            const absX = Math.abs(deltaX);
            const absY = Math.abs(deltaY);
            
            if (absX > state.threshold || absY > state.threshold) {
                state.direction = absX > absY ? 'horizontal' : 'vertical';
            }
        }
        
        // 制約の適用
        if (state.direction) {
            this.applyMovementConstraint();
        }
    }
    
    applyMovementConstraint() {
        const state = this.shiftDragState;
        let constraintApplied = false;
        
        this.getSelectedNodes().forEach(node => {
            const startPos = state.nodeStartPositions.get(node);
            if (!startPos) return;
            
            if (state.direction === 'horizontal' && node.pos[1] !== startPos.y) {
                node.pos[1] = startPos.y;
                constraintApplied = true;
            } else if (state.direction === 'vertical' && node.pos[0] !== startPos.x) {
                node.pos[0] = startPos.x;
                constraintApplied = true;
            }
        });
        
        if (constraintApplied) {
            app.canvas.setDirty(true, true);
        }
    }
    
    endShiftDrag() {
        this.resetShiftDrag();
    }
    
    resetShiftDrag() {
        const state = this.shiftDragState;
        state.active = false;
        state.direction = null;
        state.nodeStartPositions.clear();
    }
    
    // ===============================================
    // 選択オーバーレイの同期
    // ===============================================
    updateSelectionOverlay(dx, dy) {
        const container = app.canvasEl.parentElement;
        const overlayElement = container?.querySelector('.selection-overlay-container');
        
        if (!overlayElement) return;
        
        // 現在位置の取得と計算
        const style = overlayElement.style;
        const currentLeft = parseFloat(style.left) || 0;
        const currentTop = parseFloat(style.top) || 0;
        
        // スケール考慮
        const scale = app.canvas.ds?.scale || 1;
        const newLeft = currentLeft + (dx * scale);
        const newTop = currentTop + (dy * scale);
        
        // 位置更新
        style.left = `${newLeft}px`;
        style.top = `${newTop}px`;
    }
}

// ===============================================
// 設定項目の定義
// ===============================================
const enableArrowMoveSetting = {
    name: "Enable Arrow Key Node Movement",
    id: _name("EnableArrowMove"),
    type: "boolean",
    defaultValue: true, 
    onChange: (value) => {
        if (movementManager) {
            movementManager.enableArrowMove = value;
        }
    },
};

const moveStepsSetting = {
    name: "Move Steps with ARROW key",
    id: _name("moveSteps"),
    type: "slider",
    defaultValue: 100, 
    attrs: { min: 1, max: 400, step: 1 },
    onChange: (value) => {
        if (movementManager) {
            movementManager.moveSteps = value;
        }
    },
};

const moveStepsShiftSetting = {
    name: "Move Steps with SHIFT+ARROW key", 
    id: _name("moveStepsShift"), 
    type: "slider", 
    defaultValue: 200, 
    attrs: { min: 1, max: 400, step: 1 }, 
    onChange: (value) => {
        if (movementManager) {
            movementManager.moveStepsShift = value;
        }
    }, 
};

const moveStepsCtrlSetting = {
    name: "Move Steps with CTRL+ARROW key", 
    id: _name("moveStepsCtrl"), 
    type: "slider", 
    defaultValue: 10, 
    attrs: { min: 1, max: 400, step: 1 }, 
    onChange: (value) => {
        if (movementManager) {
            movementManager.moveStepsCtrl = value;
        }
    }, 
};

// ===============================================
// グローバルインスタンスと拡張機能登録
// ===============================================
let movementManager = null;

const extension = {
    name: _name("LinearMove"),
    
    init: async function(app) {
        movementManager = new MovementManager();
    },
    
    settings: [
        enableArrowMoveSetting, 
        moveStepsSetting, 
        moveStepsShiftSetting, 
        moveStepsCtrlSetting
    ].slice().reverse(),
    
    setup: async function(app) {
        if (!movementManager) return;
        
        // 設定を読み込み
        movementManager.enableArrowMove = app.ui.settings.getSettingValue(enableArrowMoveSetting.id);
        movementManager.moveSteps = app.ui.settings.getSettingValue(moveStepsSetting.id);
        movementManager.moveStepsShift = app.ui.settings.getSettingValue(moveStepsShiftSetting.id);
        movementManager.moveStepsCtrl = app.ui.settings.getSettingValue(moveStepsCtrlSetting.id);
        
        // 機能を初期化
        movementManager.initialize();
        
        // ページを離れる際のクリーンアップ
        window.addEventListener('beforeunload', () => {
            movementManager?.cleanup();
        });
    }
};

app.registerExtension(extension);