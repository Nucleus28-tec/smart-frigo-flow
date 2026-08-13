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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_reclassification_decision: {
        Args: { _decision: string; _suggestion_id: string }
        Returns: Json
      }
      get_period_summary: { Args: { _period_id: string }; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
      log_activity: {
        Args: {
          _action: string
          _entity_id?: string
          _entity_type: string
          _metadata?: Json
        }
        Returns: string
      }
      recalculate_period_indicators: {
        Args: { _period_id: string }
        Returns: Json
      }
      sync_accounts_for_period: { Args: { _period_id: string }; Returns: Json }
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
