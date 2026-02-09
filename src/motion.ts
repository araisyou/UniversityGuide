import { LAppDelegate } from './lappdelegate';
import * as LAppDefine from './lappdefine';

/**
 * Chatアクションのmotionに対応して、指定IDのモーションを再生する。
 */
export function playMotionById(id: string): boolean {
  const manager = LAppDelegate.getInstance().getMainLive2DManager();
  if (!manager) return false;

  // MotionListにない場合も一応試行するが、ログを出す。
  if (!LAppDefine.MotionList.includes(id)) {
    console.warn(`motion id not in MotionList: ${id}`);
  }

  manager.playMotion(id);
  return true;
}
