/* 端到端口径验证：在 Node 里模拟 localStorage，跑通回填、验收、退回、越权、待办/评估/演练联动。 */
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const memoryStore = new Map<string, string>()
;(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (k: string) => (memoryStore.has(k) ? memoryStore.get(k)! : null),
    setItem: (k: string, v: string) => void memoryStore.set(k, v),
    removeItem: (k: string) => void memoryStore.delete(k),
  },
}
;(globalThis as Record<string, unknown>).document = {
  createElement: () => ({ href: '', download: '', click() {} }),
  body: { appendChild() {}, removeChild() {} },
}
;(globalThis as Record<string, unknown>).URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} }
;(globalThis as Record<string, unknown>).Blob = class {}

const TODAY = '2026-10-06'

const hs = await import('../src/api/hazard-service.ts')
const store = await import('../src/data/local-store.ts')

let passed = 0
let failed = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name} ${extra}`)
  }
}

// 1. 存量隐患回填
console.log('一、存量隐患按发现日期回填（等级推定期限）')
const rows = hs.hazardRows(TODAY)
check('隐患共 9 条', rows.length === 9, String(rows.length))
const h4 = hs.findHazard(4, TODAY)! // 较大，2025-11-18 发现，无期限
check('较大隐患期限推定 = 发现+15天', h4['整改期限'] === '2025-12-03', String(h4['整改期限']))
check('回填备注标明推定口径', String(h4['回填备注']).includes('推定15天'))
const h6 = hs.findHazard(6, TODAY)! // 重大，2026-06-15，无期限无…（有班组）
check('重大隐患期限推定 = 发现+7天', h6['整改期限'] === '2026-06-22', String(h6['整改期限']))
const h8 = hs.findHazard(8, TODAY)! // 无责任班组
check('残缺责任班组推定土建维保班', h8['责任班组'] === '土建维保班', String(h8['责任班组']))
check('回填幂等：备注不重复', String(h8['回填备注']).match(/存量回填v1/g)?.length === 1)

console.log('二、逾期是派生标记（以 2026-10-06 为准）')
const s1 = hs.hazardSummary(TODAY)
// 逾期：h5 期限9-20整改中；h6 期限6-22待整改；h9 期限9-30整改中；h4 期限2025-12-03整改中；h1-h3已验收不算
check('逾期隐患 4 条', s1.overdue === 4, String(s1.overdue))
check('已验收不判逾期', hs.findHazard(1, TODAY)!['abnormal'] === false)
check('未验收 open=6（待办应同数）', s1.open === 6, String(s1.open))

console.log('三、历史单据以完工日期为轴、按当年版补齐')
const leaks = store.listRows('leak')
const l2 = leaks.find((r) => r.id === 2)! // 2021 残缺
check('渗漏2021残缺单按2021版补处置方式', String(l2['处置方式']).includes('灌浆'), String(l2['处置方式']))
check('渗漏2021残缺单完工日期推定（发现+14天）', l2['完工日期'] === '2021-06-16', String(l2['完工日期']))
check('历史回填留痕', String(l2['回填备注']).includes('历史回填v1'))
const l4 = leaks.find((r) => r.id === 4)! // 2023 残缺，同年有完整版 id3
check('2023残缺单按2023年版补齐班组', l4['处置班组'] === '给排水班', String(l4['处置班组']))
const l6 = leaks.find((r) => r.id === 6)!
check('在办处置单不拿历史模板套（仍处置中、空处置班组）', l6['处置班组'] === '土建维保班')
const mains = store.listRows('maintenance')
const m2 = mains.find((r) => r.id === 2)! // 2022 检修残缺，同年有完整版 id1
check('检修2022残缺单按当年版补类别', m2['检修类别'] === '定期保养', String(m2['检修类别']))
check('检修历史回填不改原完整单', String(mains.find((r) => r.id === 1)!['回填备注'] ?? '') === '')

console.log('四、班组归属：越权与只读入口')
const jidian = { team: '机电运维班', operator: '李振东' }
const tujian = { team: '土建维保班', operator: '周建国' }
const viewer = { team: '观摩账号（只读）', operator: '外来检查' }
const r1 = hs.dispatchHazard(6, jidian) // h6 归属安消维保班
check('非归属班组派发被驳回', !r1.ok && r1.message.includes('越权'), r1.message)
const r2 = hs.dispatchHazard(6, viewer)
check('只读入口派发被驳回', !r2.ok && r2.message.includes('只读'), r2.message)
const r3 = hs.submitAcceptance(6, { pass: true, reason: '' }, jidian, TODAY)
check('非归属班组验收被驳回', !r3.ok && r3.message.includes('归属'), r3.message)

console.log('五、验收通过：一次性落库 + 清逾期 + 幂等')
const anxiao = { team: '安消维保班', operator: '高雪' }
const before = hs.findHazard(6, TODAY)!
check('验收前 h6 为逾期状态', before['abnormal'] === true)
const d6 = hs.dispatchHazard(6, anxiao, TODAY)
check('归属班组派发成功', d6.ok, d6.message)
const r4 = hs.submitAcceptance(6, { pass: true, reason: '闭门器更换后闭门合格' }, anxiao, TODAY)
check('归属班组验收成功', r4.ok, r4.message)
const after = hs.findHazard(6, TODAY)!
check('验收后状态=已验收', after['status'] === '已验收')
check('验收日期当天落库', after['验收日期'] === TODAY)
check('验收结论落库', after['验收结论'] === '验收通过')
check('验收班组落库', after['验收班组'] === '安消维保班')
check('编号/部位/等级/期限仍在（同一事实源）', Boolean(after['隐患编号'] && after['隐患部位'] && after['隐患等级'] && after['整改期限']))
check('逾期标记已清除', after['abnormal'] === false)
const s2 = hs.hazardSummary(TODAY)
check('概览逾期数同步减为 3', s2.overdue === 3, String(s2.overdue))
const r5 = hs.submitAcceptance(6, { pass: true, reason: '再点一次' }, anxiao, TODAY)
check('重复提交验收不生效', !r5.ok && r5.message.includes('只生效一次'), r5.message)
const s3 = hs.hazardSummary(TODAY)
check('重复提交后统计不变（已验收数不涨）', s3.accepted === s2.accepted)

console.log('六、退回重改：期限顺延并留痕')
const r6 = hs.submitAcceptance(5, { pass: false, reason: '' }, jidian, TODAY)
check('退回无原因被拒绝', !r6.ok, r6.message)
const oldDeadline = String(hs.findHazard(5, TODAY)!['整改期限'])
const r7 = hs.submitAcceptance(5, { pass: false, reason: '继电器型号不符，要求重换' }, jidian, TODAY)
check('退回重改成功', r7.ok, r7.message)
const h5 = hs.findHazard(5, TODAY)!
// 原期限 2026-09-20 < 今天，基准取今天 10-06，较大? 不，h5 一般 → +30天 = 11-05
check('退回后按较晚日顺延（一般+30天）', h5['整改期限'] === '2026-11-05', String(h5['整改期限']))
check('顺延晚于原期限', h5['整改期限'] > oldDeadline)
check('退回次数+1', Number(h5['退回次数']) === 1)
check('逾期随新期限清除', h5['abnormal'] === false)
const trail = hs.hazardTrail(h5)
check('留痕含退回原因与期限前后值', trail.some((l) => l.action === '退回重改' && l.deadlineBefore === oldDeadline && l.deadlineAfter === '2026-11-05'))

console.log('七、处置结论回写待办：两边条数一致')
const todos = hs.listTodos(TODAY)
const openTodos = todos.filter((t) => t.pending)
check('待办总数=隐患总数', todos.length === hs.hazardRows(TODAY).length, `${todos.length}`)
const s4 = hs.hazardSummary(TODAY)
check('待核销待办=未验收隐患', openTodos.length === s4.open, `${openTodos.length} vs ${s4.open}`)
const t6 = todos.find((t) => t['隐患id'] === 6)!
check('已验收隐患对应待办已核销并带处置结论', !t6.pending && t6['验收结论'] === '验收通过')
const t5 = todos.find((t) => t['隐患id'] === 5)!
check('退回重改待办标题体现退回', t5['待办标题'].includes('退回重改'))

console.log('八、验收结论同步应急演练评估清单 + 重排演练')
const assessments = hs.listAssessments()
const a6 = assessments.filter((a) => a['隐患id'] === 6)
check('h6 通过结论同步 1 条', a6.length === 1 && a6[0]['验收结论'] === '验收通过')
const a5 = assessments.filter((a) => a['隐患id'] === 5)
check('h5 退回结论也同步', a5.some((a) => a['验收结论'] === '退回重改'))
const plans = hs.listDrillPlans()
const active = plans.filter((p) => p.status === '待组织')
check('每次验收重排，当前仅一份生效计划', active.length === 1, String(active.length))
check('生效计划关联未验收隐患数', active[0]['关联隐患数'] === s4.open, String(active[0]['关联隐患数']))
check('旧计划留痕为已重排', plans.filter((p) => p.status === '已重排').length >= 1, JSON.stringify(plans.map((p) => ({ id: p.id, status: p.status }))))

console.log('九、补录：缺项补齐 + 验收闭环后待办同步核销')
const reg = hs.registerHazard({ 隐患部位: '测试舱测试点' }, tujian, TODAY)
check('补录成功并返回编号', reg.ok && /HAZA-2026-\d{3}/.test(String((reg as { id?: number }).id !== undefined ? hs.hazardRows(TODAY).find((r) => r.id === reg.id)!['隐患编号'] : '')))
const newRow = hs.hazardRows(TODAY).find((r) => r.id === reg.id)!
check('补录缺等级按一般、期限+30天', newRow['隐患等级'] === '一般' && newRow['整改期限'] === '2026-11-05', String(newRow['整改期限']))
check('补录归属当前班组', newRow['责任班组'] === '土建维保班')
const s5 = hs.hazardSummary(TODAY)
check('补录后待办条数仍与未验收一致', hs.listTodos(TODAY).filter((t) => t.pending).length === s5.open)
const regDenied = hs.registerHazard({ 隐患部位: 'x' }, viewer, TODAY)
check('只读入口不能补录', !regDenied.ok)
// 派发再验收新补录隐患
const d1 = hs.dispatchHazard(reg.id!, tujian, TODAY)
check('本班组派发成功', d1.ok)
const acc1 = hs.submitAcceptance(reg.id!, { pass: true, reason: '' }, tujian, TODAY)
check('本班组验收成功', acc1.ok)
const s6 = hs.hazardSummary(TODAY)
check('闭环后待办条数再次对齐', hs.listTodos(TODAY).filter((t) => t.pending).length === s6.open)

console.log('十、持久化：退出再打开读到同一份（localStorage 快照对账）')
const snapshot = memoryStore.get('urban-utility-tunnel:entries')!
const parsedSnapshot = JSON.parse(snapshot)
const reCount = parsedSnapshot.hazard.length
check('localStorage 隐患落库条数一致', reCount === hs.hazardRows(TODAY).length)
// 模拟重新加载：清模块缓存通过重新 import 不行（ESM 缓存），直接比对关键行
const persistedH6 = parsedSnapshot.hazard.find((r: { id: number }) => r.id === 6)
check('落库快照含验收结论', persistedH6['验收结论'] === '验收通过')
check('落库快照逾期位已清', persistedH6.abnormal === false)
const recon1 = hs.hazardReconciliation(TODAY)
check('对账：未验收=待办待核销', recon1.未验收隐患 === recon1.待办待核销 && recon1.条数一致)

console.log('十一、导出与列表/报表同源')
const csv = hs.exportHazards(TODAY).content
const dataLines = csv.split('\n').slice(1)
check('导出行数=隐患总数', dataLines.length === hs.hazardRows(TODAY).length, String(dataLines.length))
check('导出含逾期列且 h5 已不逾期', dataLines.some((l) => l.includes('HAZA-2026-012') && l.endsWith('正常')))
const acsv = hs.exportAssessments().content.split('\n').slice(1)
check('评估清单导出行数=清单条数', acsv.length === hs.listAssessments().length)

console.log('十二、历史已验收隐患（早年）启动即同步评估清单')
const a1 = assessments.filter((a) => a['隐患id'] === 1)
check('2021年历史验收隐患补登评估清单', a1.length === 1 && a1[0]['验收日期'] === '2021-04-08')

// 额外：把存储快照写出来供人工检查
const out = join(mkdtempSync(join(tmpdir(), 'hazard-')), 'snapshot.json')
writeFileSync(out, JSON.stringify(parsedSnapshot, null, 2))
console.log(`\n快照已写出：${out}`)

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
