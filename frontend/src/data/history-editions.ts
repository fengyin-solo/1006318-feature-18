/**
 * 历史单据回填口径（以完工日期为轴，按当年那版补齐）
 *
 * 适用对象：渗漏水处置单(leak)、设施检修记录(maintenance) —— 两类都带"完工日期"。
 * 原则：
 *  1. 只补残缺/占位值（空值、生成器留下的"xx样例N"），已有真值一律不动；
 *  2. 用哪一版由单据自己的完工年份决定（"当年那版"），不拿今天的口径改写历史；
 *  3. 历史状态（处置状态/检修状态）原口径保留，不随新状态机重算；
 *  4. 无完工日期时回退到发现日期/计划工期取轴；都缺则按最新版补并标注"轴缺失"；
 *  5. 每个补齐值的原值、取值版本、依据都进审计留痕。
 *
 * 版本划分依据：
 *  - v2019：GB 51354-2019《城市地下综合管廊运行维护及安全技术标准》2019-12-01 实施，
 *           初期台账只有粗口径（渗漏只分"点渗/面渗"、检修按"日常/定期"两类）；
 *  - v2021：各地运维细则陆续落地（如北京 DB11/T 1731-2020 系列），2021 起渗漏水细分到
 *           "点渗/面渗/线渗/冒水"，检修引入"故障抢修"类，处置方式要求到工艺；
 *  - v2024：2024 版城市安全运行要求闭环留痕，处置方式必须带"后注浆/引排"等工艺名、
 *           更换部件要求到型号位（缺型号至少留部件类+"待核型号"）。
 */

export type EditionRule = {
  edition: string
  label: string
  basis: string
  yearMatch: (year: number) => boolean
  defaults: Record<string, Record<string, string>>
}

export const EDITION_RULES: EditionRule[] = [
  {
    edition: 'v2019',
    label: '2019版（GB 51354-2019初期台账口径）',
    basis: 'GB 51354-2019 初期台账：渗漏粗分点渗/面渗，检修仅日常/定期两类',
    yearMatch: (y) => y <= 2020,
    defaults: {
      leak: {
        渗漏程度: '点渗',
        处置方式: '表面封堵',
        处置班组: '土建一班',
      },
      maintenance: {
        检修类别: '定期检修',
        计划工期: '7天',
        更换部件: '无更换',
        检修班组: '机电二班',
      },
    },
  },
  {
    edition: 'v2021',
    label: '2021版（运维细则细化口径）',
    basis: '2021起地方运维细则：渗漏细分到冒水，检修新增故障抢修类，处置方式到工艺',
    yearMatch: (y) => y >= 2021 && y <= 2023,
    defaults: {
      leak: {
        渗漏程度: '点渗',
        处置方式: '注浆封堵',
        处置班组: '土建一班',
      },
      maintenance: {
        检修类别: '计划检修',
        计划工期: '5天',
        更换部件: '密封件（待核型号）',
        检修班组: '机电二班',
      },
    },
  },
  {
    edition: 'v2024',
    label: '2024版（闭环留痕口径）',
    basis: '2024版城市安全运行闭环要求：工艺名必填、部件到型号位',
    yearMatch: (y) => y >= 2024,
    defaults: {
      leak: {
        渗漏程度: '点渗',
        处置方式: '后注浆+引排',
        处置班组: '土建一班',
      },
      maintenance: {
        检修类别: '预防性检修',
        计划工期: '3天',
        更换部件: '密封组件（待核型号）',
        检修班组: '机电二班',
      },
    },
  },
]

/** 完工年份 → 版本；年份异常（非日期/缺失）由调用方先回退取轴，再走这里。 */
export function editionForYear(year: number): EditionRule {
  return EDITION_RULES.find((r) => r.yearMatch(year)) ?? EDITION_RULES[EDITION_RULES.length - 1]
}

export function latestEdition(): EditionRule {
  return EDITION_RULES[EDITION_RULES.length - 1]
}

/** 回填字段（不含状态与日期字段，状态永远原口径保留）。 */
export const BACKFILL_FIELDS: Record<string, string[]> = {
  leak: ['渗漏点位', '渗漏程度', '处置方式', '处置班组'],
  maintenance: ['检修对象', '检修类别', '检修班组', '计划工期', '更换部件'],
}
