import { defineStore } from 'pinia'

import { ALL_TEAMS, READONLY_TEAM, WORK_TEAMS } from '@/data/domain'

const TEAM_STORAGE_KEY = 'urban-utility-tunnel:team'

function initialTeam(): string {
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = window.localStorage.getItem(TEAM_STORAGE_KEY)
    if (saved && ALL_TEAMS.includes(saved as (typeof ALL_TEAMS)[number])) {
      return saved
    }
  }
  return WORK_TEAMS[0]
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市地下综合管廊运行维护管理平台',
    team: initialTeam(),
    teams: ALL_TEAMS as unknown as string[],
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isReadonly: (state) => state.team === READONLY_TEAM,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setTeam(team: string) {
      this.team = team
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(TEAM_STORAGE_KEY, team)
      }
    },
  },
})
