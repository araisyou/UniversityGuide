/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { ACubismMotion } from '@framework/motion/acubismmotion';
import { csmVector } from '@framework/type/csmvector';

import * as LAppDefine from './lappdefine';
import { LAppModel } from './lappmodel';
import { LAppPal } from './lapppal';
import { LAppSubdelegate } from './lappsubdelegate';

/**
 * サンプルアプリケーションにおいてCubismModelを管理するクラス
 * モデル生成と破棄、タップイベントの処理、モデル切り替えを行う。
 */
export class LAppLive2DManager {
  /**
   * 現在のシーンで保持しているすべてのモデルを解放する
   */
  private releaseAllModel(): void {
    this._models.clear();
  }

  /**
   * 画面を更新するときの処理
   * モデルの更新処理及び描画処理を行う
   */
  public onUpdate(): void {
    const { width, height } = this._subdelegate.getCanvas();

    const projection: CubismMatrix44 = new CubismMatrix44();
    const model: LAppModel = this._models.at(0);

    if (model.getModel()) {
      if (model.getModel().getCanvasWidth() > 1.0 && width < height) {
        // 横に長いモデルを縦長ウィンドウに表示する際モデルの横サイズでscaleを算出する
        model.getModelMatrix().setWidth(2.0);
        projection.scale(1.0, width / height);
      } else {
        projection.scale(height / width, 1.0);
      }

      // 必要があればここで乗算
      if (this._viewMatrix != null) {
        projection.multiplyByMatrix(this._viewMatrix);
      }
    }

    model.update();
    model.draw(projection); // 参照渡しなのでprojectionは変質する。
  }

  /**
   * 単一モデルを読み込む
   */
  private loadModel(): void {
    const model: string = LAppDefine.ModelDir;
    const modelPath: string = LAppDefine.ResourcesPath + model + '/';
    const modelJsonName: string = `${model}.model3.json`;

    if (LAppDefine.DebugLogEnable) {
      LAppPal.printMessage(`[APP]model: ${model}`);
    }

    this.releaseAllModel();
    const instance = new LAppModel();
    instance.setSubdelegate(this._subdelegate);
    instance.loadAssets(modelPath, modelJsonName);
    this._models.pushBack(instance);
  }

  public setViewMatrix(m: CubismMatrix44) {
    for (let i = 0; i < 16; i++) {
      this._viewMatrix.getArray()[i] = m.getArray()[i];
    }
  }

  /**
   * モデルの追加
   */
  public addModel(sceneIndex: number = 0): void {
    this.loadModel();
  }

  /**
   * 指定グループのモーションを再生する。index未指定ならランダム。
   */
  public playMotion(group: string, index?: number): void {
    const model: LAppModel = this._models.at(0);
    if (!model) return;
    const count = model['_modelSetting']?.getMotionCount(group) ?? 0;
    if (count <= 0) {
      if (LAppDefine.DebugLogEnable) {
        LAppPal.printMessage(`[APP]motion group not found: ${group}`);
      }
      return;
    }
    const selected =
      typeof index === 'number'
        ? Math.max(0, Math.min(count - 1, index))
        : Math.floor(Math.random() * count);
    model.startMotion(group, selected, LAppDefine.PriorityForce);
  }

  /**
   * 音声ファイルを再生し、リップシンクを有効にする。
   */
  public playLipSyncFromFile(path: string): void {
    const model: LAppModel = this._models.at(0);
    if (!model) return;
    model.startLipSyncFromFile(path);
  }

  /**
   * コンストラクタ
   */
  public constructor() {
    this._subdelegate = null;
    this._viewMatrix = new CubismMatrix44();
    this._models = new csmVector<LAppModel>();
  }

  /**
   * 解放する。
   */
  public release(): void {}

  /**
   * 初期化する。
   * @param subdelegate
   */
  public initialize(subdelegate: LAppSubdelegate): void {
    this._subdelegate = subdelegate;
    this.loadModel();
  }

  /**
   * 自身が所属するSubdelegate
   */
  private _subdelegate: LAppSubdelegate;

  _viewMatrix: CubismMatrix44; // モデル描画に用いるview行列
  _models: csmVector<LAppModel>; // モデルインスタンスのコンテナ

  // モーション再生開始のコールバック関数
  beganMotion = (self: ACubismMotion): void => {
    LAppPal.printMessage('Motion Began:');
    console.log(self);
  };
  // モーション再生終了のコールバック関数
  finishedMotion = (self: ACubismMotion): void => {
    LAppPal.printMessage('Motion Finished:');
    console.log(self);
  };
}
