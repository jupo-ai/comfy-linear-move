import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { $el } from "../../scripts/ui.js";
import { debug, _name, _endpoint, api_get, api_post } from "./utils.js";

// ===============================================
// MovementManager - ノード・グループ移動拡張機能
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
            groupStartPositions: new Map(),
            direction: null, // 'horizontal', 'vertical', null
            threshold: 10
        };
        
        // イベントハンドラーをバインド
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
        
        // 画像表示エリアでも、ノードまたはグループが選択されていれば移動を許可
        const imageClasses = ['comfy-image', 'image-preview'];
        const imageTags = ['CANVAS', 'IMG'];
        if (imageClasses.some(cls => activeElement?.classList?.contains(cls)) || 
            imageTags.includes(activeElement?.tagName)) {
            const { nodes, groups } = this.getSelectedElements();
            return nodes.length > 0 || groups.length > 0;
        }

        return true;
    }

    getSelectedNodes() {
        const selectedNodes = app.canvas.selected_nodes;
        return typeof selectedNodes === "object" ? Object.values(selectedNodes) : [];
    }
    
    getSelectedGroups() {
        // ComfyUIのグループ選択状態を取得
        const canvas = app.canvas;
        const selectedGroups = [];
        
        if (canvas.graph && canvas.graph._groups) {
            canvas.graph._groups.forEach(group => {
                if (group.selected || (canvas.selected_group === group)) {
                    selectedGroups.push(group);
                }
            });
        }
        
        return selectedGroups;
    }
    
    getSelectedElements() {
        return {
            nodes: this.getSelectedNodes(),
            groups: this.getSelectedGroups()
        };
    }
    
    // グループ内のノードを取得
    getNodesInGroup(group) {
        return group._nodes || group.nodes || [];
    }
    
    // グループ内の子グループを取得
    getChildGroups(group) {
        if (!group._children && !group.children) return [];
        
        const children = group._children || group.children;
        const childGroups = [];
        
        children.forEach(child => {
            if (child instanceof LGraphGroup || (child.constructor && child.constructor.name === 'LGraphGroup')) {
                childGroups.push(child);
            }
        });
        
        return childGroups;
    }
    
    // グループ内の全ノードを再帰的に取得（ネストグループも含む）
    getAllNodesInGroupRecursive(group, visited = new Set()) {
        if (visited.has(group)) return [];
        visited.add(group);
        
        // 直接的な子ノード
        let allNodes = [...this.getNodesInGroup(group)];
        
        // 子グループ内のノードも再帰的に取得
        const childGroups = this.getChildGroups(group);
        childGroups.forEach(childGroup => {
            if (!visited.has(childGroup)) {
                allNodes = allNodes.concat(this.getAllNodesInGroupRecursive(childGroup, visited));
            }
        });
        
        return allNodes;
    }
    
    // ネストしたグループを再帰的に取得
    getAllGroupsRecursive(group, visited = new Set()) {
        if (visited.has(group)) return [];
        visited.add(group);
        
        const allGroups = [group];
        
        // 子グループを直接取得
        const childGroups = this.getChildGroups(group);
        childGroups.forEach(childGroup => {
            if (!visited.has(childGroup)) {
                allGroups.push(...this.getAllGroupsRecursive(childGroup, visited));
            }
        });
        
        return allGroups;
    }
    
    moveElements(dx, dy) {
        const { nodes, groups } = this.getSelectedElements();
        
        if (nodes.length === 0 && groups.length === 0) return false;
        
        // 選択されたノード（直接選択）
        const selectedNodes = new Set(nodes);
        
        // 選択されたグループとその中のノードを処理
        const processedGroups = new Set();
        const groupNodes = new Set();
        
        groups.forEach(group => {
            const allGroups = this.getAllGroupsRecursive(group);
            allGroups.forEach(g => {
                if (!processedGroups.has(g)) {
                    // グループを移動
                    g.pos[0] += dx;
                    g.pos[1] += dy;
                    processedGroups.add(g);
                    
                    // グループ内のノードも移動対象に追加
                    const nodesInGroup = this.getAllNodesInGroupRecursive(g);
                    nodesInGroup.forEach(node => groupNodes.add(node));
                }
            });
        });
        
        // 直接選択されたノードを移動
        selectedNodes.forEach(node => {
            node.pos[0] += dx;
            node.pos[1] += dy;
        });
        
        // グループ内のノードを移動（直接選択されていないもののみ）
        groupNodes.forEach(node => {
            if (!selectedNodes.has(node)) {
                node.pos[0] += dx;
                node.pos[1] += dy;
            }
        });
        
        // 選択オーバーレイも同期
        this.updateSelectionOverlay(dx, dy);
        
        // キャンバス更新
        app.canvas.setDirty(true, true);
        return true;
    }
    
    // 従来のmoveNodesメソッドを維持（後方互換性のため）
    moveNodes(dx, dy) {
        return this.moveElements(dx, dy);
    }
    
    // ===============================================
    // キーボード移動機能
    // ===============================================
    handleKeyDown(e) {
        const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        
        // 早期リターン条件をまとめて処理
        if (!arrowKeys.includes(e.key) || 
            !this.enableArrowMove || 
            !this.canNodeMove()) {
            return;
        }
        
        const { nodes, groups } = this.getSelectedElements();
        if (nodes.length === 0 && groups.length === 0) {
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
        this.moveElements(dx, dy);
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
        const { nodes, groups } = this.getSelectedElements();
        groups.forEach(group => group?.recomputeInsideNodes()); // 選択したグループの内部を再計算
        if (e.shiftKey && (nodes.length > 0 || groups.length > 0)) {
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
        const { nodes, groups } = this.getSelectedElements();
        
        state.active = true;
        state.direction = null;
        state.startMouse = { x: e.clientX, y: e.clientY };
        
        // 選択されたノード（直接選択）の開始位置を記録
        state.nodeStartPositions.clear();
        const selectedNodes = new Set(nodes);
        nodes.forEach(node => {
            state.nodeStartPositions.set(node, { x: node.pos[0], y: node.pos[1] });
        });
        
        // グループの開始位置を記録
        state.groupStartPositions.clear();
        const processedGroups = new Set();
        const groupNodes = new Set();
        
        groups.forEach(group => {
            const allGroups = this.getAllGroupsRecursive(group);
            allGroups.forEach(g => {
                if (!processedGroups.has(g)) {
                    state.groupStartPositions.set(g, { x: g.pos[0], y: g.pos[1] });
                    processedGroups.add(g);
                    
                    // グループ内のノードの開始位置も記録
                    const nodesInGroup = this.getAllNodesInGroupRecursive(g);
                    nodesInGroup.forEach(node => {
                        if (!selectedNodes.has(node) && !state.nodeStartPositions.has(node)) {
                            state.nodeStartPositions.set(node, { x: node.pos[0], y: node.pos[1] });
                            groupNodes.add(node);
                        }
                    });
                }
            });
        });
    }
    
    processShiftDrag(e) {
        const state = this.shiftDragState;
        const deltaX = e.clientX - state.startMouse.x;
        const deltaY = e.clientY - state.startMouse.y;
        
        // 方向決定
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
            // グループ移動時は、グループ内のノードも制約を適用する必要がある
            this.synchronizeGroupNodes();
        }
    }
    
    applyMovementConstraint() {
        const state = this.shiftDragState;
        let constraintApplied = false;
        
        // 全ノード（直接選択 + グループ内）の制約適用
        state.nodeStartPositions.forEach((startPos, node) => {
            if (state.direction === 'horizontal' && node.pos[1] !== startPos.y) {
                node.pos[1] = startPos.y;
                constraintApplied = true;
            } else if (state.direction === 'vertical' && node.pos[0] !== startPos.x) {
                node.pos[0] = startPos.x;
                constraintApplied = true;
            }
        });
        
        // グループの制約適用
        state.groupStartPositions.forEach((startPos, group) => {
            if (state.direction === 'horizontal' && group.pos[1] !== startPos.y) {
                group.pos[1] = startPos.y;
                constraintApplied = true;
            } else if (state.direction === 'vertical' && group.pos[0] !== startPos.x) {
                group.pos[0] = startPos.x;
                constraintApplied = true;
            }
        });
        
        if (constraintApplied) {
            app.canvas.setDirty(true, true);
        }
    }
    
    // グループ移動時にグループ内のノードを同期
    synchronizeGroupNodes() {
        const state = this.shiftDragState;
        const { groups } = this.getSelectedElements();
        let syncApplied = false;
        
        groups.forEach(group => {
            const allGroups = this.getAllGroupsRecursive(group);
            allGroups.forEach(g => {
                const groupStartPos = state.groupStartPositions.get(g);
                if (!groupStartPos) return;
                
                // グループの現在の移動量を計算
                const groupDeltaX = g.pos[0] - groupStartPos.x;
                const groupDeltaY = g.pos[1] - groupStartPos.y;
                
                // グループ内のノードを同期
                const nodesInGroup = this.getAllNodesInGroupRecursive(g);
                nodesInGroup.forEach(node => {
                    const nodeStartPos = state.nodeStartPositions.get(node);
                    if (!nodeStartPos) return;
                    
                    // グループの移動量に合わせてノードを移動
                    const expectedNodeX = nodeStartPos.x + groupDeltaX;
                    const expectedNodeY = nodeStartPos.y + groupDeltaY;
                    
                    if (node.pos[0] !== expectedNodeX || node.pos[1] !== expectedNodeY) {
                        node.pos[0] = expectedNodeX;
                        node.pos[1] = expectedNodeY;
                        syncApplied = true;
                    }
                });
            });
        });
        
        if (syncApplied) {
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
        state.groupStartPositions.clear();
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