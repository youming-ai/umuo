// 与正式配置共用同一个中间件（路由逻辑只有 worker/src/dispatch.ts 一份），这里只是让 Void 在本目录扫描到它。
export { default } from '../../middleware/01.legacy'
