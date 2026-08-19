export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      accounting_periods: {
        Row: {
          created_at: string
          created_by: string
          id: string
          label: string
          last_recalculated_at: string | null
          reference_month: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          label: string
          last_recalculated_at?: string | null
          reference_month: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          label?: string
          last_recalculated_at?: string | null
          reference_month?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_periods_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_log: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json | null
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_messages: {
        Row: {
          client_message_id: string | null
          created_at: string
          id: string
          parts: Json
          role: string
          thread_id: string
          user_id: string
        }
        Insert: {
          client_message_id?: string | null
          created_at?: string
          id?: string
          parts?: Json
          role: string
          thread_id: string
          user_id: string
        }
        Update: {
          client_message_id?: string | null
          created_at?: string
          id?: string
          parts?: Json
          role?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "agent_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_threads: {
        Row: {
          agent: string
          created_at: string
          id: string
          period_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent?: string
          created_at?: string
          id?: string
          period_id?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent?: string
          created_at?: string
          id?: string
          period_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_threads_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "accounting_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_threads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: string
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value: string
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_findings: {
        Row: {
          created_at: string
          description: string
          entry_id: string | null
          finding_type: string
          id: string
          period_id: string
          resolved_by: string | null
          severity: string
          status: string
          suggested_fix: string | null
        }
        Insert: {
          created_at?: string
          description: string
          entry_id?: string | null
          finding_type: string
          id?: string
          period_id: string
          resolved_by?: string | null
          severity?: string
          status?: string
          suggested_fix?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          entry_id?: string | null
          finding_type?: string
          id?: string
          period_id?: string
          resolved_by?: string | null
          severity?: string
          status?: string
          suggested_fix?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_findings_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_findings_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "accounting_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_findings_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chart_of_accounts: {
        Row: {
          confidence_score: number | null
          created_at: string
          id: string
          is_confirmed: boolean
          nature: string | null
          source_code: string | null
          source_name: string
          times_confirmed: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          id?: string
          is_confirmed?: boolean
          nature?: string | null
          source_code?: string | null
          source_name: string
          times_confirmed?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          id?: string
          is_confirmed?: boolean
          nature?: string | null
          source_code?: string | null
          source_name?: string
          times_confirmed?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_indicators: {
        Row: {
          calculated_at: string
          id: string
          indicator_key: string
          indicator_value: number
          period_id: string
        }
        Insert: {
          calculated_at?: string
          id?: string
          indicator_key: string
          indicator_value: number
          period_id: string
        }
        Update: {
          calculated_at?: string
          id?: string
          indicator_key?: string
          indicator_value?: number
          period_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_indicators_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "accounting_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_statements: {
        Row: {
          content: Json
          generated_at: string
          generated_by: string
          id: string
          period_id: string
          statement_type: string
        }
        Insert: {
          content: Json
          generated_at?: string
          generated_by: string
          id?: string
          period_id: string
          statement_type: string
        }
        Update: {
          content?: Json
          generated_at?: string
          generated_by?: string
          id?: string
          period_id?: string
          statement_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_statements_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_statements_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "accounting_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      imported_files: {
        Row: {
          created_at: string
          file_type: string
          id: string
          mime_type: string
          original_name: string
          period_id: string
          processing_error: string | null
          processing_status: string
          storage_path: string
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          file_type: string
          id?: string
          mime_type: string
          original_name: string
          period_id: string
          processing_error?: string | null
          processing_status?: string
          storage_path: string
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          file_type?: string
          id?: string
          mime_type?: string
          original_name?: string
          period_id?: string
          processing_error?: string | null
          processing_status?: string
          storage_path?: string
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "imported_files_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "accounting_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "imported_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_account_openings: {
        Row: {
          account_name: string
          account_reduced_code: string
          created_at: string
          id: string
          opening_balance: number
          period_id: string
        }
        Insert: {
          account_name: string
          account_reduced_code: string
          created_at?: string
          id?: string
          opening_balance?: number
          period_id: string
        }
        Update: {
          account_name?: string
          account_reduced_code?: string
          created_at?: string
          id?: string
          opening_balance?: number
          period_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_account_openings_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "accounting_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_legs: {
        Row: {
          account_id: string | null
          account_reduced_code: string
          cancelled_at: string | null
          cancelled_by: string | null
          counterpart_reduced_code: string | null
          created_at: string
          created_by: string | null
          credit: number
          debit: number
          doc_number: string | null
          entry_date: string | null
          entry_group: string | null
          file_id: string | null
          historico: string | null
          id: string
          line_no: number | null
          origin: string
          period_id: string
          running_balance: number | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id?: string | null
          account_reduced_code: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          counterpart_reduced_code?: string | null
          created_at?: string
          created_by?: string | null
          credit?: number
          debit?: number
          doc_number?: string | null
          entry_date?: string | null
          entry_group?: string | null
          file_id?: string | null
          historico?: string | null
          id?: string
          line_no?: number | null
          origin?: string
          period_id: string
          running_balance?: number | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string | null
          account_reduced_code?: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          counterpart_reduced_code?: string | null
          created_at?: string
          created_by?: string | null
          credit?: number
          debit?: number
          doc_number?: string | null
          entry_date?: string | null
          entry_group?: string | null
          file_id?: string | null
          historico?: string | null
          id?: string
          line_no?: number | null
          origin?: string
          period_id?: string
          running_balance?: number | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_legs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_legs_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_legs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_legs_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "imported_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_legs_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "accounting_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_legs_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_account_audit: {
        Row: {
          account_key: string
          account_name: string | null
          actor_id: string | null
          created_at: string
          entity_type: string
          field_changed: string
          id: string
          new_value: string | null
          old_value: string | null
          period_id: string | null
          source: string
        }
        Insert: {
          account_key: string
          account_name?: string | null
          actor_id?: string | null
          created_at?: string
          entity_type?: string
          field_changed: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          period_id?: string | null
          source?: string
        }
        Update: {
          account_key?: string
          account_name?: string | null
          actor_id?: string | null
          created_at?: string
          entity_type?: string
          field_changed?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          period_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_account_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_account_audit_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "accounting_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_accounts: {
        Row: {
          confidence: number | null
          created_at: string
          hierarchical_code: string | null
          id: string
          is_active: boolean
          is_analytic: boolean
          level: number | null
          link_status: string
          name: string
          nature: string | null
          parent_code: string | null
          reduced_code: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          hierarchical_code?: string | null
          id?: string
          is_active?: boolean
          is_analytic?: boolean
          level?: number | null
          link_status?: string
          name: string
          nature?: string | null
          parent_code?: string | null
          reduced_code: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          hierarchical_code?: string | null
          id?: string
          is_active?: boolean
          is_analytic?: boolean
          level?: number | null
          link_status?: string
          name?: string
          nature?: string | null
          parent_code?: string | null
          reduced_code?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_accounts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          account_id: string | null
          created_at: string
          entry_date: string | null
          file_id: string
          id: string
          is_manually_edited: boolean
          nature: string | null
          period_id: string
          raw_value: number
          reviewed_value: number | null
          source_account_name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          entry_date?: string | null
          file_id: string
          id?: string
          is_manually_edited?: boolean
          nature?: string | null
          period_id: string
          raw_value: number
          reviewed_value?: number | null
          source_account_name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          entry_date?: string | null
          file_id?: string
          id?: string
          is_manually_edited?: boolean
          nature?: string | null
          period_id?: string
          raw_value?: number
          reviewed_value?: number | null
          source_account_name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "imported_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "accounting_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id: string
          is_active?: boolean
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      recalculation_logs: {
        Row: {
          created_at: string
          entry_id: string | null
          field_changed: string
          file_id: string | null
          id: string
          manual_edit_preserved: boolean
          new_value: string | null
          old_value: string | null
          period_id: string
        }
        Insert: {
          created_at?: string
          entry_id?: string | null
          field_changed: string
          file_id?: string | null
          id?: string
          manual_edit_preserved?: boolean
          new_value?: string | null
          old_value?: string | null
          period_id: string
        }
        Update: {
          created_at?: string
          entry_id?: string | null
          field_changed?: string
          file_id?: string | null
          id?: string
          manual_edit_preserved?: boolean
          new_value?: string | null
          old_value?: string | null
          period_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recalculation_logs_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recalculation_logs_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "imported_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recalculation_logs_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "accounting_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      reclassification_suggestions: {
        Row: {
          account_id: string | null
          confidence_score: number | null
          created_at: string
          current_nature: string | null
          decided_at: string | null
          decided_by: string | null
          entry_id: string | null
          id: string
          period_id: string
          reasoning: string | null
          status: string
          suggested_nature: string
        }
        Insert: {
          account_id?: string | null
          confidence_score?: number | null
          created_at?: string
          current_nature?: string | null
          decided_at?: string | null
          decided_by?: string | null
          entry_id?: string | null
          id?: string
          period_id: string
          reasoning?: string | null
          status?: string
          suggested_nature: string
        }
        Update: {
          account_id?: string | null
          confidence_score?: number | null
          created_at?: string
          current_nature?: string | null
          decided_at?: string | null
          decided_by?: string | null
          entry_id?: string | null
          id?: string
          period_id?: string
          reasoning?: string | null
          status?: string
          suggested_nature?: string
        }
        Relationships: [
          {
            foreignKeyName: "reclassification_suggestions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reclassification_suggestions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reclassification_suggestions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reclassification_suggestions_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "accounting_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      trial_balance_lines: {
        Row: {
          code: string
          created_at: string
          credito: number
          debito: number
          file_id: string | null
          id: string
          is_analytic: boolean
          level: number
          name: string
          period_id: string
          saldo_anterior: number
          saldo_atual: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          credito?: number
          debito?: number
          file_id?: string | null
          id?: string
          is_analytic?: boolean
          level?: number
          name: string
          period_id: string
          saldo_anterior?: number
          saldo_atual?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          credito?: number
          debito?: number
          file_id?: string | null
          id?: string
          is_analytic?: boolean
          level?: number
          name?: string
          period_id?: string
          saldo_anterior?: number
          saldo_atual?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trial_balance_lines_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "imported_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trial_balance_lines_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "accounting_periods"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_reclassification_decision: {
        Args: { _decision: string; _suggestion_id: string }
        Returns: Json
      }
      bulk_upsert_ledger_accounts: { Args: { _rows: Json }; Returns: Json }
      cancel_journal_entry: {
        Args: { _leg_id: string; _motivo?: string }
        Returns: Json
      }
      chart_accounts_grid: {
        Args: {
          _limit?: number
          _nature?: string
          _offset?: number
          _only_active?: boolean
          _only_pending?: boolean
          _period_id?: string
          _query?: string
          _type?: string
        }
        Returns: Json
      }
      generate_period_statements: {
        Args: { _period_id: string }
        Returns: Json
      }
      get_period_summary: { Args: { _period_id: string }; Returns: Json }
      hier_level: { Args: { _hier: string }; Returns: number }
      hier_parent: { Args: { _hier: string }; Returns: string }
      import_journal_legs: {
        Args: { _file_id: string; _legs: Json; _reset?: boolean }
        Returns: Json
      }
      import_trial_balance_lines: {
        Args: { _file_id: string; _lines: Json }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      journal_account_statement: {
        Args: {
          _limit?: number
          _offset?: number
          _period_id: string
          _reduced_code: string
        }
        Returns: Json
      }
      journal_document: {
        Args: { _doc_number: string; _period_id: string }
        Returns: Json
      }
      journal_entries_grid: {
        Args: {
          _account?: string
          _from?: string
          _include_cancelled?: boolean
          _limit?: number
          _offset?: number
          _period_id: string
          _query?: string
          _to?: string
        }
        Returns: Json
      }
      journal_pending_report: { Args: { _period_id: string }; Returns: Json }
      journal_report_analytic: {
        Args: {
          _codes?: string[]
          _doc_number?: string
          _from?: string
          _max_rows?: number
          _period_id: string
          _to?: string
        }
        Returns: Json
      }
      journal_search: {
        Args: {
          _limit?: number
          _offset?: number
          _period_id: string
          _query: string
        }
        Returns: Json
      }
      journal_top_counterparts: {
        Args: { _limit?: number; _period_id: string; _reduced_code: string }
        Returns: Json
      }
      link_reduced_accounts: { Args: { _period_id: string }; Returns: Json }
      log_activity: {
        Args: {
          _action: string
          _entity_id?: string
          _entity_type: string
          _metadata?: Json
        }
        Returns: string
      }
      merge_file_entries: {
        Args: { _entries: Json; _file_id: string }
        Returns: Json
      }
      nature_from_code: { Args: { _code: string }; Returns: string }
      nature_from_hierarchical: { Args: { _hier: string }; Returns: string }
      nightly_refresh_periods: { Args: never; Returns: Json }
      norm_account_base: { Args: { _name: string }; Returns: string }
      norm_account_name: { Args: { _name: string }; Returns: string }
      recalculate_period_indicators: {
        Args: { _period_id: string }
        Returns: Json
      }
      recalculate_period_indicators_internal: {
        Args: { _period_id: string }
        Returns: Json
      }
      reconcile_journal_vs_trial_balance: {
        Args: { _period_id: string }
        Returns: Json
      }
      set_account_link: {
        Args: {
          _hierarchical_code: string
          _nature: string
          _reduced_code: string
        }
        Returns: Json
      }
      set_ledger_account_active: {
        Args: { _active: boolean; _id: string }
        Returns: Json
      }
      set_ledger_accounts_nature: {
        Args: { _ids: string[]; _nature?: string; _parent_code?: string }
        Returns: Json
      }
      sync_accounts_for_period: { Args: { _period_id: string }; Returns: Json }
      trial_balance_report: {
        Args: {
          _codes?: string[]
          _from?: string
          _period_id: string
          _to?: string
        }
        Returns: Json
      }
      txt_norm: { Args: { _t: string }; Returns: string }
      upsert_ledger_account: {
        Args: {
          _hierarchical_code: string
          _id: string
          _is_analytic: boolean
          _name: string
          _nature: string
          _reduced_code: string
        }
        Returns: Json
      }
      upsert_manual_journal_entry: {
        Args: {
          _credit_code: string
          _debit_code: string
          _doc_number: string
          _entry_date: string
          _historico: string
          _leg_id?: string
          _period_id: string
          _value: number
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
