/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 动作提交时的操作者上下文：班组归属校验在服务层完成，页面只做只读化展示。 */
export type ActionContext = {
  team: string
  operator: string
}

/** 处置结论回写的整改待办：一条未验收隐患对应一条待办，验收后核销，两边条数一致。 */
export type TodoRow = EntryRow & {
  隐患id: number
  待办标题: string
  责任班组: string
  验收结论: string
}

/** 验收结论同步到应急演练侧的评估清单行。 */
export type AssessmentRow = EntryRow & {
  隐患id: number
  隐患编号: string
  隐患部位: string
  隐患等级: string
  验收结论: string // 验收通过 / 退回重改
  验收日期: string
  验收班组: string
}

/** 每次验收后按最新隐患情况重排一次的演练计划（旧计划自动作废）。 */
export type DrillPlanRow = EntryRow & {
  计划编号: string
  演练场景: string
  关联隐患数: number
  涉及班组: string
  建议日期: string
  触发验收日期: string
}
