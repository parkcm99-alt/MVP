/**
 * Supabase database types — manually maintained until `supabase gen types` is wired.
 *
 * Run after connecting a real project:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
 */

// ── Row types ─────────────────────────────────────────────────────────────────

export interface AgentRow {
  id:              string;   // AgentRole — 'planner' | 'architect' | ...
  session_id:      string;
  name:            string;
  emoji:           string;
  status:          string;   // AgentStatus
  current_task:    string | null;
  position_x:      number;
  position_y:      number;
  completed_tasks: number;
  updated_at:      string;   // ISO timestamp
}

export interface TaskRow {
  id:          string;
  session_id:  string;
  title:       string;
  description: string;
  assigned_to: string | null;  // AgentRole
  status:      string;         // TaskStatus
  priority:    string;         // TaskPriority
  created_at:  string;
  updated_at:  string;
}

export interface EventRow {
  id:          string;
  session_id:  string;
  agent_id:    string;   // AgentRole
  agent_name:  string;
  agent_color: string;
  type:        string;   // EventType
  message:     string;
  metadata:    Record<string, unknown> | null;  // jsonb — free-form extra data
  timestamp:   string;  // ISO timestamp
}

export interface AgentTraceRow {
  id:            string;
  session_id:    string;
  agent_id:      string;   // AgentRole
  trace_type:    string;   // 'llm_call' | 'tool_use' | 'handoff' | 'decision'
  input_tokens:  number | null;
  output_tokens: number | null;
  latency_ms:    number | null;
  model:         string | null;    // e.g. 'claude-sonnet-4-6'
  metadata:      Record<string, unknown> | null;
  created_at:    string;
}

// ── Insert / Update types ─────────────────────────────────────────────────────

export type AgentInsert  = Omit<AgentRow,  'updated_at'> & Partial<Pick<AgentRow,  'updated_at'>>;
export type AgentUpdate  = Partial<Omit<AgentRow,  'id' | 'session_id'>>;

export type TaskInsert   = Omit<TaskRow,   'created_at' | 'updated_at'> & Partial<Pick<TaskRow,   'created_at' | 'updated_at'>>;
export type TaskUpdate   = Partial<Omit<TaskRow,   'id' | 'session_id' | 'created_at'>>;

export type EventInsert  = Omit<EventRow, 'id' | 'timestamp'> & Partial<Pick<EventRow, 'id' | 'timestamp'>>;

export type AgentTraceInsert = Omit<AgentTraceRow, 'created_at'> & Partial<Pick<AgentTraceRow, 'created_at'>>;

// ── Database shape (passed to createClient<Database>) ────────────────────────
// Each table must include Relationships to satisfy supabase-js GenericTable.

export interface Database {
  public: {
    Tables: {
      agents: {
        Row:           AgentRow;
        Insert:        AgentInsert;
        Update:        AgentUpdate;
        Relationships: [];
      };
      tasks: {
        Row:           TaskRow;
        Insert:        TaskInsert;
        Update:        TaskUpdate;
        Relationships: [];
      };
      events: {
        Row:           EventRow;
        Insert:        EventInsert;
        Update:        Partial<EventRow>;
        Relationships: [];
      };
      agent_traces: {
        Row:           AgentTraceRow;
        Insert:        AgentTraceInsert;
        Update:        Partial<AgentTraceRow>;
        Relationships: [];
      };
    };
    Views:          Record<never, never>;   // no views — prevents overload ambiguity in from()
    Functions:      Record<never, never>;   // no functions
    Enums:          Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
