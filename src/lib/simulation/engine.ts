'use client';

import { useSimStore } from '@/store/simulationStore';
import type { AgentRole, AgentStatus, EventType, TaskPriority } from '@/types';
import { DESK_STAND, MEETING_SEATS } from './config';
import { eventBus } from './eventBus';

type Store = ReturnType<typeof useSimStore.getState>;

// ─── role → specific work status ──────────────────────────────────────────────

const WORK_STATUS: Record<AgentRole, AgentStatus> = {
  planner:   'thinking',
  architect: 'thinking',
  developer: 'coding',
  reviewer:  'reviewing',
  qa:        'testing',
};

// ─── helpers ───────────────────────────────────────────────────────────────────

function store(): Store {
  return useSimStore.getState();
}

function speak(id: AgentRole, text: string, ms = 3500) {
  store().setSpeech(id, text);
  return after(ms, () => store().setSpeech(id, null));
}

function log(id: AgentRole, type: EventType, message: string) {
  const a = store().agents[id];
  store().addEvent({ agentId: id, agentName: a.name, agentColor: a.primaryColor, type, message });
}

function workAt(id: AgentRole, taskName: string, speechText?: string) {
  const s = store();
  s.moveAgent(id, DESK_STAND[id]);
  s.setStatus(id, WORK_STATUS[id]);
  s.setTask(id, taskName);
  log(id, 'task', `[${store().agents[id].name}] ${taskName}`);
  eventBus.emit('agent.assigned', { agentId: id, data: { task: taskName } });
  if (speechText) speak(id, speechText);
}

function idle(id: AgentRole) {
  store().setStatus(id, 'idle');
  store().setTask(id, null);
  store().setSpeech(id, null);
}

function walkTo(id: AgentRole, seat: { x: number; y: number }) {
  store().setStatus(id, 'walking');
  store().moveAgent(id, seat);
  eventBus.emit('agent.moved', { agentId: id });
}

function after(ms: number, fn: () => void): ReturnType<typeof setTimeout> {
  return setTimeout(fn, ms);
}

// ─── main 48-second scenario ──────────────────────────────────────────────────

type Step = { t: number; fn: () => void };

function buildTimeline(): { steps: Step[]; duration: number } {
  const steps: Step[] = [];
  const at = (t: number, fn: () => void) => steps.push({ t, fn });

  // ── Phase 1: 업무 시작 ──────────────────────────────────────────────────────
  at(0, () => {
    store().addEvent({ agentId: 'planner', agentName: 'System', agentColor: '#64748B', type: 'system', message: '🏢 새 스프린트가 시작되었습니다' });
    store().tasks.forEach(t => {
      if (t.status === 'done') store().updateTask(t.id, { status: 'backlog' });
    });
  });
  at(400,  () => workAt('planner',   '요구사항 분석',       '요구사항 분석 중... 📋'));
  at(800,  () => workAt('architect', '시스템 아키텍처 설계', '아키텍처 설계 중... 🏗️'));
  at(1200, () => workAt('developer', '백엔드 API 개발',     '코딩 시작! 💻'));
  at(1600, () => workAt('reviewer',  '코드 리뷰 준비',       '리뷰 대기 중... 🔍'));
  at(2000, () => workAt('qa',        '테스트 계획 수립',     '테스트 케이스 작성 중 🧪'));

  // ── Phase 2: 아키텍처 미팅 ──────────────────────────────────────────────────
  at(5000, () => {
    speak('planner', '아키텍처 리뷰 미팅 시작! 📅');
    log('planner', 'meeting', '[Planner] 아키텍처 리뷰 미팅 소집');
    eventBus.emit('meeting.started', { agentId: 'planner' });
  });
  at(6500, () => {
    walkTo('planner',   MEETING_SEATS[0]);
    walkTo('architect', MEETING_SEATS[1]);
  });
  at(8200, () => {
    store().setStatus('planner',   'meeting');
    store().setStatus('architect', 'meeting');
    speak('planner',   '마이크로서비스로 분리할까요?');
    log('planner', 'meeting', '[Planner + Architect] 아키텍처 미팅');
  });
  at(10500, () => speak('architect', 'Supabase + Next.js 추천합니다! ✅'));
  at(12500, () => {
    speak('planner', '좋아요! 확정합시다 🎯');
    log('architect', 'chat', '[Architect] 기술 스택 확정: Supabase + Next.js');
  });
  at(14500, () => {
    walkTo('planner',   DESK_STAND.planner);
    walkTo('architect', DESK_STAND.architect);
  });
  at(16000, () => {
    store().setStatus('planner',   WORK_STATUS.planner);
    store().setStatus('architect', WORK_STATUS.architect);
    store().tasks.forEach(t => {
      if (t.assignedTo === 'planner'   && t.status === 'backlog') store().updateTask(t.id, { status: 'in_progress' });
      if (t.assignedTo === 'architect' && t.status === 'backlog') store().updateTask(t.id, { status: 'in_progress' });
    });
  });

  // ── Phase 3: 개발 → 리뷰 요청 ─────────────────────────────────────────────
  at(18000, () => {
    speak('developer', '기능 구현 완료! PR 올릴게요 🚀');
    log('developer', 'task', '[Developer] PR #42 오픈');
    store().tasks.forEach(t => {
      if (t.assignedTo === 'developer' && t.status === 'in_progress') store().updateTask(t.id, { status: 'review' });
    });
    eventBus.emit('task.completed', { agentId: 'developer', data: { task: 'PR #42' } });
  });
  at(19500, () => {
    walkTo('developer', { x: DESK_STAND.reviewer.x - 40, y: DESK_STAND.reviewer.y });
    log('developer', 'chat', '[Developer → Reviewer] PR 리뷰 요청');
  });
  at(21000, () => {
    speak('developer', 'PR #42 리뷰 부탁드려요! 🙏');
    speak('reviewer',  '바로 확인할게요! 👀');
    store().setStatus('developer', 'meeting');
  });
  at(23500, () => {
    walkTo('developer', DESK_STAND.developer);
  });
  at(25000, () => {
    store().setStatus('developer', 'coding');
    store().setStatus('reviewer',  'thinking');
    speak('reviewer', '코드 분석 중... 🤔');
    log('reviewer', 'review', '[Reviewer] PR #42 코드 분석 시작');
    eventBus.emit('agent.status.changed', { agentId: 'reviewer', data: { status: 'thinking' } });
  });

  // ── Phase 4: QA 버그 발견 ──────────────────────────────────────────────────
  at(27500, () => {
    speak('qa', '테스트 실행 중... ⚙️');
    log('qa', 'task', '[QA] 회귀 테스트 실행');
  });
  at(29500, () => {
    speak('qa', '버그 발견! Issue #7 🐛');
    log('qa', 'system', '[QA] 버그 리포트: Issue #7 오픈');
    store().addTask({ title: 'Issue #7 버그 수정', description: '회귀 테스트 실패', assignedTo: 'developer', status: 'in_progress', priority: 'high' });
    eventBus.emit('issue.found', { agentId: 'qa', data: { issue: 'Issue #7' } });
    // developer is blocked until fix starts
    store().setStatus('developer', 'blocked');
    store().setSpeech('developer', '버그 확인 중... ⛔');
    eventBus.emit('agent.status.changed', { agentId: 'developer', data: { status: 'blocked' } });
  });
  at(31000, () => {
    speak('developer', 'Issue #7 확인, 수정 중... 🔧');
    store().setStatus('developer', 'coding');
    log('developer', 'task', '[Developer] Issue #7 핫픽스 작업');
    eventBus.emit('agent.status.changed', { agentId: 'developer', data: { status: 'coding' } });
  });

  // ── Phase 5: 리뷰 완료 ────────────────────────────────────────────────────
  at(32500, () => {
    speak('reviewer', 'LGTM! 코멘트 2개 남겼어요 ✅');
    log('reviewer', 'review', '[Reviewer] PR #42 리뷰 완료 — LGTM');
    store().tasks.forEach(t => {
      if (t.assignedTo === 'developer' && t.status === 'review') store().updateTask(t.id, { status: 'done' });
    });
    store().bumpCompleted('developer');
    eventBus.emit('task.completed', { agentId: 'reviewer', data: { task: 'PR #42 Review' } });
  });

  // ── Phase 6: 스탠드업 전체 미팅 ──────────────────────────────────────────
  at(34500, () => {
    speak('planner', '데일리 스탠드업 시작! 📣');
    log('planner', 'meeting', '[ALL] 데일리 스탠드업 미팅 시작');
    eventBus.emit('meeting.started', { agentId: 'planner' });
    const roles: AgentRole[] = ['planner', 'architect', 'developer', 'reviewer', 'qa'];
    roles.forEach((id, i) => walkTo(id, MEETING_SEATS[i]));
  });
  at(36500, () => {
    const roles: AgentRole[] = ['planner', 'architect', 'developer', 'reviewer', 'qa'];
    roles.forEach(id => store().setStatus(id, 'meeting'));
    speak('planner',   '요구사항 분석 완료! ✅');
  });
  at(38000, () => speak('architect', '기술 스택 확정했습니다 🏗️'));
  at(39000, () => speak('developer', '핫픽스 배포 완료 🚀'));
  at(40000, () => speak('reviewer',  '코드 품질 A+ 🌟'));
  at(41000, () => {
    speak('qa', '모든 테스트 통과! 🧪✅');
    store().tasks.forEach(t => {
      if (t.status === 'in_progress') store().updateTask(t.id, { status: 'done' });
    });
    store().bumpCompleted('qa');
    store().bumpCompleted('planner');
    store().bumpCompleted('architect');
    store().bumpCompleted('reviewer');
  });

  // ── Phase 7: 복귀 및 초기화 ───────────────────────────────────────────────
  at(43000, () => {
    const roles: AgentRole[] = ['planner', 'architect', 'developer', 'reviewer', 'qa'];
    roles.forEach(id => walkTo(id, DESK_STAND[id]));
    log('planner', 'system', '🎉 스프린트 완료! 다음 사이클 준비 중...');
  });
  at(45500, () => {
    const roles: AgentRole[] = ['planner', 'architect', 'developer', 'reviewer', 'qa'];
    roles.forEach(id => idle(id));
  });

  return { steps, duration: 48000 };
}

// ─── engine class ──────────────────────────────────────────────────────────────

export class SimulationEngine {
  private timers: ReturnType<typeof setTimeout>[] = [];

  // ── public lifecycle ───────────────────────────────────────────────────────

  start() {
    this.stop();
    store().setRunning(true);
    this.seedTasks();
    this.cycle();
  }

  stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    store().setRunning(false);
  }

  // ── public scenario methods (callable from UI buttons) ────────────────────

  /** Alias for start() — exposed for UI "Start Task" button */
  startSprint() {
    this.start();
  }

  /** Interrupt current flow and immediately run a team meeting */
  callMeeting() {
    this.stop();
    store().setRunning(true);
    this._runMeeting(() => this.cycle());
  }

  /** Add a random mock task to the backlog */
  createMockTask() {
    const titles: string[] = [
      'UI 컴포넌트 개선', '성능 최적화', '보안 패치', 'API 엔드포인트 추가',
      '문서 업데이트', 'DB 마이그레이션', '에러 핸들링 강화', '캐시 레이어 추가',
    ];
    const roles: AgentRole[]     = ['developer', 'architect', 'qa', 'reviewer', 'planner'];
    const priorities: TaskPriority[] = ['high', 'medium', 'low'];
    const title      = titles[Math.floor(Math.random() * titles.length)];
    const assignedTo = roles[Math.floor(Math.random() * roles.length)];
    const priority   = priorities[Math.floor(Math.random() * priorities.length)];
    store().addTask({ title, description: '목 태스크', assignedTo, status: 'backlog', priority });
    eventBus.emit('task.created', { agentId: assignedTo, data: { title } });
    speak(assignedTo, `새 태스크: ${title} 📌`, 2500);
  }

  /** Jump directly to sprint completion (marks all tasks done + standup) */
  completeSprint() {
    this.stop();
    store().setRunning(true);
    this._runCompletionPhase(() => {
      this.timers.push(after(3000, () => this.cycle()));
    });
  }

  /** Full reset — clears all state and stops simulation */
  resetOffice() {
    this.stop();
    store().resetStore();
    log('planner', 'system', '🔄 오피스 리셋 완료');
  }

  // ── private scenario fragments ────────────────────────────────────────────

  private _runMeeting(onDone?: () => void) {
    const roles: AgentRole[] = ['planner', 'architect', 'developer', 'reviewer', 'qa'];
    const t = (ms: number, fn: () => void) => this.timers.push(after(ms, fn));

    t(0, () => {
      speak('planner', '긴급 미팅! 모두 모여주세요 📣');
      log('planner', 'meeting', '[ALL] 긴급 미팅 소집');
      eventBus.emit('meeting.started', { agentId: 'planner' });
      roles.forEach((id, i) => walkTo(id, MEETING_SEATS[i]));
    });
    t(2000, () => {
      roles.forEach(id => store().setStatus(id, 'meeting'));
      speak('planner', '현황 공유합시다 💬');
    });
    t(3500, () => speak('architect', '아키텍처 검토 완료 🏗️'));
    t(4500, () => speak('developer', '개발 진행 중 💻'));
    t(5500, () => speak('qa', '테스트 통과율 87% 🧪'));
    t(7000, () => {
      speak('planner', '계속 진행! 💪');
      log('planner', 'meeting', '[ALL] 미팅 종료');
      roles.forEach(id => walkTo(id, DESK_STAND[id]));
    });
    t(9000, () => {
      roles.forEach(id => store().setStatus(id, WORK_STATUS[id]));
      if (onDone) onDone();
    });
  }

  private _runCompletionPhase(onDone?: () => void) {
    const roles: AgentRole[] = ['planner', 'architect', 'developer', 'reviewer', 'qa'];
    const t = (ms: number, fn: () => void) => this.timers.push(after(ms, fn));

    t(0, () => {
      speak('planner', '스프린트 완료! 🎉');
      log('planner', 'system', '🎉 스프린트 강제 완료');
      store().tasks.forEach(task => {
        if (task.status !== 'done') store().updateTask(task.id, { status: 'done' });
      });
      roles.forEach((id, i) => walkTo(id, MEETING_SEATS[i]));
    });
    t(2000, () => {
      roles.forEach(id => store().setStatus(id, 'meeting'));
      speak('planner', '모두 수고했습니다! ✅');
    });
    t(3500, () => speak('qa', '전체 테스트 통과! 🧪✅'));
    t(4500, () => {
      roles.forEach(id => {
        store().bumpCompleted(id);
        walkTo(id, DESK_STAND[id]);
      });
      eventBus.emit('task.completed', { agentId: 'planner', data: { task: 'Sprint' } });
    });
    t(6500, () => {
      roles.forEach(id => idle(id));
      log('planner', 'system', '🔄 다음 스프린트 준비 중...');
      if (onDone) onDone();
    });
  }

  // ── internal ──────────────────────────────────────────────────────────────

  private seedTasks() {
    if (store().tasks.length > 0) return;
    const s = store();
    s.addTask({ title: 'RESTful API 설계',  description: 'OpenAPI 스펙 작성',      assignedTo: 'architect', status: 'backlog',     priority: 'high' });
    s.addTask({ title: '인증 모듈 개발',    description: 'JWT + OAuth2 구현',       assignedTo: 'developer', status: 'in_progress', priority: 'high' });
    s.addTask({ title: 'DB 스키마 설계',    description: 'Supabase 테이블 설계',    assignedTo: 'architect', status: 'backlog',     priority: 'medium' });
    s.addTask({ title: '코드 리뷰 #38',     description: 'PR #38 리뷰',            assignedTo: 'reviewer',  status: 'review',      priority: 'high' });
    s.addTask({ title: 'E2E 테스트 스위트', description: 'Playwright 테스트 작성', assignedTo: 'qa',        status: 'backlog',     priority: 'medium' });
    s.addTask({ title: '스프린트 계획',     description: 'S-3 스프린트 계획 수립', assignedTo: 'planner',   status: 'done',        priority: 'medium' });
    s.addEvent({ agentId: 'planner', agentName: 'System', agentColor: '#64748B', type: 'system', message: '🏢 AI Agent Office 시작됨' });
  }

  private cycle() {
    const { steps, duration } = buildTimeline();
    steps.forEach(({ t, fn }) => {
      this.timers.push(after(t, fn));
    });
    this.timers.push(after(duration, () => this.cycle()));
  }
}

export const simulationEngine = new SimulationEngine();
