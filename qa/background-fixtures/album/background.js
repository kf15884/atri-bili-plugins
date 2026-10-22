"use strict";
// One registry per Koishi/HDS service, shared by separately installed Atri plugins.
// Foreground HDS never acquires this lock. In-flight HTTP requests are not preempted.
const KEY = Symbol.for("atri.background.coordinator.v1");
const registry = globalThis[KEY] || (globalThis[KEY] = new WeakMap());
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function state(service) { let x = registry.get(service); if (!x) registry.set(service, x = { lanes: new Map() }); return x; }
function idle(service, storyId) {
  return !!service && typeof service.hasPendingNarrative === 'function' &&
    typeof service.getDesktopRuntimePhase === 'function' &&
    service.getDesktopRuntimePhase() !== 'paused' && !service.hasPendingNarrative(storyId);
}
async function canStart(service, storyId) {
  if (!idle(service, storyId)) return false;
  // rc57 exposes this read-only runtime method; don't let background calls cut into a split chain.
  if (typeof service.pendingSplitSegments === 'function') {
    try { if ((await service.pendingSplitSegments(storyId)).length) return false; }
    catch { return false; }
  }
  return idle(service, storyId);
}
function fault(code) { return Object.assign(new Error(code), { code }); }
async function runBackground(service, storyId, options, work) {
  const { valid = () => true, deadline = Infinity, lane = 'model', onWait = () => {} } = options || {};
  const lanes = state(service).lanes;
  let queue = lanes.get(lane); if (!queue) lanes.set(lane, queue = []);
  const ticket = {}; queue.push(ticket);
  try {
    let delay = 100;
    for (;;) {
      if (!await valid()) throw fault('background-cancelled');
      if (Date.now() >= deadline) throw fault('background-deferred');
      if (queue[0] === ticket && await canStart(service, storyId)) break;
      onWait(); await sleep(delay); delay = Math.min(1000, delay * 2);
    }
    // Revalidate after the asynchronous validator; claim/start without another await.
    if (!idle(service, storyId)) throw fault('background-deferred');
    return await work();
  } finally {
    const i = queue.indexOf(ticket); if (i >= 0) queue.splice(i, 1);
    if (!queue.length) lanes.delete(lane);
  }
}
module.exports = { idle, canStart, runBackground };
