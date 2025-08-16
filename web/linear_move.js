import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { $el } from "../../scripts/ui.js";
import { debug, _name, _endpoint, api_get, api_post } from "./utils.js";

// ===============================================
// MovementManager - ノード移動拡張機能を管理するクラス
// ===============================================
class MovementManager {
    constructor() {
        // 基本設定
        this.enableArrowMove = true; // 矢印キー移動の有効/無効
        this.moveStep = 100; // デフォルトの移動量
        this.moveStepShift = 200;
        this.moveStepCtrl = 10;

        this.isInitialized = false;
        
        // Shift+ドラッグ制限機能の状態
        this.isShiftDragging = false;
        this.dragStartMouse = { x: 0, y: 0 };
        this.nodeStartPositions = new Map();
        this.constraintDirection = null; // 'horizontal', 'vertical', null
        this.dragThreshold = 10; // 方向決定の閾値（ピクセル）
        
        // バインドしたメソッド
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleShiftKeyChange = this.handleShiftKeyChange.bind(this);
    }
    
    // ===============================================
    // 初期化とクリーンアップ
    // ===============================================
    initialize() {
        if (this.isInitialized) return;
        
        // キーボードイベントの設定
        this.setupKeyboardEvents();
        
        // Shift+ドラッグ制限機能の設定
        this.setupShiftDragConstraint();
        
        this.isInitialized = true;
    }
    
    cleanup() {
        if (!this.isInitialized) return;
        
        // キーボードイベントの削除
        app.canvasEl.removeEventListener('keydown', this.handleKeyDown, { capture: true });
        document.removeEventListener('keydown', this.handleKeyDown, { capture: true });
        document.removeEventListener('keydown', this.handleShiftKeyChange, { capture: true });
        document.removeEventListener('keyup', this.handleShiftKeyChange, { capture: true });
        
        this.isInitialized = false;
    }
    
    // ===============================================
    // キーボード移動機能
    // ===============================================
    setupKeyboardEvents() {
        // キーボードイベントの設定
        app.canvasEl.addEventListener('keydown', this.handleKeyDown, { 
            capture: true,
            passive: false 
        });
        
        document.addEventListener('keydown', this.handleKeyDown, { 
            capture: true,
            passive: false 
        });
        
        // Shiftキーの状態監視
        document.addEventListener('keydown', this.handleShiftKeyChange, { capture: true });
        document.addEventListener('keyup', this.handleShiftKeyChange, { capture: true });
    }
    
    canNodeMove() {
        // 入力フィールドにフォーカスがある場合は無効
        const activeElement = document.activeElement;
        
        if (activeElement?.tagName === "INPUT" ||
            activeElement?.tagName === "TEXTAREA" || 
            activeElement?.isContentEditable) {
                return false;
        }
        
        // 画像表示エリアでも、ノードが選択されていれば移動を許可
        if (activeElement?.classList?.contains('comfy-image') ||
            activeElement?.classList?.contains('image-preview') ||
            activeElement?.tagName === 'CANVAS' ||
            activeElement?.tagName === 'IMG') {
            const selectedNodes = this.getSelectedNodes();
            return selectedNodes.length > 0;
        }

        return true;
    }

    getSelectedNodes() {
        const selected_nodes = app.canvas.selected_nodes;
        if (typeof selected_nodes === "object") {
            return Object.values(selected_nodes);
        }
        return [];
    }
    
    moveNodesBy(dx, dy) {
        const nodes = this.getSelectedNodes();
        if (nodes.length === 0) return;
        
        nodes.forEach(node => {
            node.pos[0] += dx;
            node.pos[1] += dy;
        });
        
        // 選択オーバーレイも一緒に移動
        this.updateSelectionOverlay(dx, dy);
        
        app.canvas.setDirty(true, true);
    }
    
    moveNodesByArrow(direction, isShiftPressed = false, isCtrlPressed = false) {
        let step = this.moveStep;
        if (isShiftPressed) step = this.moveStepShift;
        if (isCtrlPressed) step = this.moveStepCtrl;

        switch (direction) {
            case 'ArrowUp':
                this.moveNodesBy(0, -step);
                break;
            case 'ArrowDown':
                this.moveNodesBy(0, step);
                break;
            case 'ArrowLeft':
                this.moveNodesBy(-step, 0);
                break;
            case 'ArrowRight':
                this.moveNodesBy(step, 0);
                break;
        }
    }
    
    handleKeyDown(e) {
        // 矢印キーのみ処理
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            return;
        }
        
        // 矢印キー移動が無効な場合は何もしない
        if (!this.enableArrowMove) {
            return;
        }
        
        if (!this.canNodeMove()) return;

        const nodes = this.getSelectedNodes();
        if (nodes.length === 0) return;
        
        // イベントの伝播を停止
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // 修飾キーの状態を取得
        const isShiftPressed = e.shiftKey;
        const isCtrlPressed = e.ctrlKey || e.metaKey;

        this.moveNodesByArrow(e.key, isShiftPressed, isCtrlPressed);
    }
    
    handleShiftKeyChange(e) {
        // Shiftキーが離された時にドラッグ制限をリセット
        if (e.type === 'keyup' && e.key === 'Shift') {
            if (this.isShiftDragging) {
                this.endShiftDrag();
            }
        }
    }
    
    // ===============================================
    // Shift+ドラッグ制限機能
    // ===============================================
    setupShiftDragConstraint() {
        const self = this;
        
        // Pointerイベントでドラッグを監視
        app.canvasEl.addEventListener('pointerdown', (e) => {
            if (e.shiftKey) {
                self.startShiftDrag(e);
            }
        }, { capture: true });
        
        app.canvasEl.addEventListener('pointermove', (e) => {
            if (self.isShiftDragging) {
                self.handleShiftDrag(e);
            }
        }, { capture: true });
        
        app.canvasEl.addEventListener('pointerup', (e) => {
            if (self.isShiftDragging) {
                self.endShiftDrag();
            }
        }, { capture: true });
        
        // ノード位置の監視（60FPS）
        setInterval(() => {
            if (self.isShiftDragging) {
                self.monitorNodePositions();
            }
        }, 16);
    }
    
    startShiftDrag(e) {
        const selectedNodes = this.getSelectedNodes();
        if (selectedNodes.length === 0) return;
        
        this.isShiftDragging = true;
        this.constraintDirection = null;
        this.dragStartMouse = { x: e.clientX, y: e.clientY };
        
        // 選択されたノードの開始位置を記録
        this.nodeStartPositions.clear();
        selectedNodes.forEach(node => {
            this.nodeStartPositions.set(node, { x: node.pos[0], y: node.pos[1] });
        });
    }
    
    handleShiftDrag(e) {
        const deltaX = e.clientX - this.dragStartMouse.x;
        const deltaY = e.clientY - this.dragStartMouse.y;
        
        // 方向の決定
        if (!this.constraintDirection) {
            const absX = Math.abs(deltaX);
            const absY = Math.abs(deltaY);
            
            if (absX > this.dragThreshold || absY > this.dragThreshold) {
                this.constraintDirection = absX > absY ? 'horizontal' : 'vertical';
            }
        }
        
        // 方向が決定されたら即座に制限を適用
        if (this.constraintDirection) {
            this.applyConstraintImmediate();
        }
    }
    
    applyConstraintImmediate() {
        const selectedNodes = this.getSelectedNodes();
        selectedNodes.forEach(node => {
            const startPos = this.nodeStartPositions.get(node);
            if (!startPos) return;
            
            let positionChanged = false;
            
            if (this.constraintDirection === 'horizontal') {
                // 水平方向のみ移動 - Y座標を固定
                if (node.pos[1] !== startPos.y) {
                    node.pos[1] = startPos.y;
                    positionChanged = true;
                }
            } else if (this.constraintDirection === 'vertical') {
                // 垂直方向のみ移動 - X座標を固定
                if (node.pos[0] !== startPos.x) {
                    node.pos[0] = startPos.x;
                    positionChanged = true;
                }
            }
            
            if (positionChanged) {
                app.canvas.setDirty(true, true);
            }
        });
    }
    
    monitorNodePositions() {
        const selectedNodes = this.getSelectedNodes();
        selectedNodes.forEach(node => {
            const startPos = this.nodeStartPositions.get(node);
            if (startPos) {
                this.applyConstraint(node, startPos);
            }
        });
    }
    
    applyConstraint(node, startPos) {
        if (!this.constraintDirection) return;
        
        let constraintApplied = false;
        
        if (this.constraintDirection === 'horizontal') {
            if (node.pos[1] !== startPos.y) {
                node.pos[1] = startPos.y;
                constraintApplied = true;
            }
        } else if (this.constraintDirection === 'vertical') {
            if (node.pos[0] !== startPos.x) {
                node.pos[0] = startPos.x;
                constraintApplied = true;
            }
        }
        
        if (constraintApplied) {
            app.canvas.setDirty(true, true);
        }
    }
    
    endShiftDrag() {
        this.isShiftDragging = false;
        this.constraintDirection = null;
        this.nodeStartPositions.clear();
    }
    
    // ===============================================
    // 選択オーバーレイの同期
    // ===============================================
    updateSelectionOverlay(dx, dy) {
        // selection-overlay-container要素を取得
        const container = app.canvasEl.parentElement;
        if (!container) return;
        
        const overlayElement = container.querySelector('.selection-overlay-container');
        if (!overlayElement) return;
        
        // 現在の位置を取得
        const currentStyle = overlayElement.style;
        const currentLeft = parseFloat(currentStyle.left) || 0;
        const currentTop = parseFloat(currentStyle.top) || 0;
        
        // キャンバスのズーム率を考慮して移動量を計算
        const scale = app.canvas.ds?.scale || 1;
        const adjustedDx = dx * scale;
        const adjustedDy = dy * scale;
        
        // 新しい位置を設定
        const newLeft = currentLeft + adjustedDx;
        const newTop = currentTop + adjustedDy;
        
        overlayElement.style.left = `${newLeft}px`;
        overlayElement.style.top = `${newTop}px`;
    }
}

// ===============================================
// グローバルインスタンス
// ===============================================
let movementManager = null;

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

const moveStepSetting = {
    name: "Move Steps with ARROW key",
    id: _name("MoveSteps"),
    type: "slider",
    defaultValue: 100, 
    attrs: { min: 1, max: 400, step: 1 },
    onChange: (value) => {
        if (movementManager) {
            movementManager.moveStep = value;
        }
    },
};

const moveStepShiftSetting = {
    name: "Move Steps with SHIFT+ARROW key", 
    id: _name("MoveStepsShift"), 
    type: "slider", 
    defaultValue: 200, 
    attrs: { min: 1, max: 400, step: 1 }, 
    onChange: (value) => {
        if (movementManager) {
            movementManager.moveStepShift = value;
        }
    }, 
};

const moveStepCtrlSetting = {
    name: "Move Steps with CTRL+ARROW key", 
    id: _name("MoveStepsCtrl"), 
    type: "slider", 
    defaultValue: 10, 
    attrs: { min: 1, max: 400, step: 1 }, 
    onChange: (value) => {
        if (movementManager) {
            movementManager.moveStepCtrl = value;
        }
    }, 
};

// ===============================================
// 拡張機能の登録
// ===============================================
const extension = {
    name: _name("LinearMove"),
    
    init: async function(app) {
        movementManager = new MovementManager();
    },
    
    settings: [
        enableArrowMoveSetting, 
        moveStepSetting, 
        moveStepShiftSetting, 
        moveStepCtrlSetting
    ].slice().reverse(),
    
    setup: async function(app) {
        if (movementManager) {
            // 設定の初期値を読み込み
            const initialEnabled = app.ui.settings.getSettingValue(enableArrowMoveSetting.id);
            const initialStep = app.ui.settings.getSettingValue(moveStepSetting.id);
            const initialStepShift = app.ui.settings.getSettingValue(moveStepShiftSetting.id);
            const initialStepCtrl = app.ui.settings.getSettingValue(moveStepCtrlSetting.id);

            
            // マネージャーに設定を適用
            movementManager.enableArrowMove = initialEnabled;
            movementManager.moveStep = initialStep;
            movementManager.moveStepShift = initialStepShift;
            movementManager.moveStepCtrl = initialStepCtrl;
            
            // 機能を初期化
            movementManager.initialize();
        }
        
        // ページを離れる際のクリーンアップ
        window.addEventListener('beforeunload', () => {
            if (movementManager) {
                movementManager.cleanup();
            }
        });
    }
};

// 拡張機能を登録
app.registerExtension(extension);