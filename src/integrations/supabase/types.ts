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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          id: string
          preferences: Json
          rules: Json
          security: Json
          ui_state: Json
          updated_at: string
        }
        Insert: {
          id?: string
          preferences?: Json
          rules?: Json
          security?: Json
          ui_state?: Json
          updated_at?: string
        }
        Update: {
          id?: string
          preferences?: Json
          rules?: Json
          security?: Json
          ui_state?: Json
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          changed_at: string
          id: string
          new_data: Json | null
          old_data: Json | null
          row_id: string | null
          table_name: string
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          changed_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          row_id?: string | null
          table_name: string
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          changed_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          row_id?: string | null
          table_name?: string
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          client_type: string
          created_at: string
          folder: string | null
          id: string
          mgmv: Json | null
          name: string
          notes: string | null
          phone: string
          updated_at: string
        }
        Insert: {
          client_type?: string
          created_at?: string
          folder?: string | null
          id?: string
          mgmv?: Json | null
          name: string
          notes?: string | null
          phone?: string
          updated_at?: string
        }
        Update: {
          client_type?: string
          created_at?: string
          folder?: string | null
          id?: string
          mgmv?: Json | null
          name?: string
          notes?: string | null
          phone?: string
          updated_at?: string
        }
        Relationships: []
      }
      import_history: {
        Row: {
          agreements_created: number | null
          agreements_replaced: number | null
          clients_created: number
          created_at: string
          date: string
          duration_ms: number | null
          errors: number
          file: string
          file_hash: string | null
          id: string
          products_added: number
          skipped_duplicates: number | null
          source: string
          status: string
        }
        Insert: {
          agreements_created?: number | null
          agreements_replaced?: number | null
          clients_created?: number
          created_at?: string
          date?: string
          duration_ms?: number | null
          errors?: number
          file: string
          file_hash?: string | null
          id?: string
          products_added?: number
          skipped_duplicates?: number | null
          source: string
          status: string
        }
        Update: {
          agreements_created?: number | null
          agreements_replaced?: number | null
          clients_created?: number
          created_at?: string
          date?: string
          duration_ms?: number | null
          errors?: number
          file?: string
          file_hash?: string | null
          id?: string
          products_added?: number
          skipped_duplicates?: number | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      import_progress: {
        Row: {
          created_at: string
          current_idx: number
          done: boolean
          errors: Json
          file_hash: string
          folders: Json
          id: string
          messages: Json
          started_at: string
          stats: Json
          total: number
          updated_at: string
          user_id: string
          zip_name: string
        }
        Insert: {
          created_at?: string
          current_idx?: number
          done?: boolean
          errors?: Json
          file_hash: string
          folders?: Json
          id?: string
          messages?: Json
          started_at?: string
          stats?: Json
          total?: number
          updated_at?: string
          user_id: string
          zip_name: string
        }
        Update: {
          created_at?: string
          current_idx?: number
          done?: boolean
          errors?: Json
          file_hash?: string
          folders?: Json
          id?: string
          messages?: Json
          started_at?: string
          stats?: Json
          total?: number
          updated_at?: string
          user_id?: string
          zip_name?: string
        }
        Relationships: []
      }
      mgmv_agreements: {
        Row: {
          ai_confidence: number | null
          ai_review_applied_at: string | null
          ai_review_raw_result: Json | null
          ai_reviewed: boolean
          client_id: string
          client_name: string
          client_phone: string
          created_at: string
          detection_log: Json | null
          due_day: number | null
          first_due_date: string | null
          id: string
          installment_value: number | null
          installments_count: number | null
          needs_review: boolean
          next_due_date: string | null
          original_notes: string | null
          paid_installments: number
          paid_value: number
          pending_installments: number | null
          remaining_value: number | null
          review_status: string
          source_file: string | null
          source_folder: string | null
          status: string
          total_agreement_value: number | null
          updated_at: string
        }
        Insert: {
          ai_confidence?: number | null
          ai_review_applied_at?: string | null
          ai_review_raw_result?: Json | null
          ai_reviewed?: boolean
          client_id: string
          client_name?: string
          client_phone?: string
          created_at?: string
          detection_log?: Json | null
          due_day?: number | null
          first_due_date?: string | null
          id?: string
          installment_value?: number | null
          installments_count?: number | null
          needs_review?: boolean
          next_due_date?: string | null
          original_notes?: string | null
          paid_installments?: number
          paid_value?: number
          pending_installments?: number | null
          remaining_value?: number | null
          review_status?: string
          source_file?: string | null
          source_folder?: string | null
          status?: string
          total_agreement_value?: number | null
          updated_at?: string
        }
        Update: {
          ai_confidence?: number | null
          ai_review_applied_at?: string | null
          ai_review_raw_result?: Json | null
          ai_reviewed?: boolean
          client_id?: string
          client_name?: string
          client_phone?: string
          created_at?: string
          detection_log?: Json | null
          due_day?: number | null
          first_due_date?: string | null
          id?: string
          installment_value?: number | null
          installments_count?: number | null
          needs_review?: boolean
          next_due_date?: string | null
          original_notes?: string | null
          paid_installments?: number
          paid_value?: number
          pending_installments?: number | null
          remaining_value?: number | null
          review_status?: string
          source_file?: string | null
          source_folder?: string | null
          status?: string
          total_agreement_value?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mgmv_agreements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      mgmv_installments: {
        Row: {
          agreement_id: string
          amount: number | null
          created_at: string
          due_date: string | null
          id: string
          installment_number: number
          paid_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          agreement_id: string
          amount?: number | null
          created_at?: string
          due_date?: string | null
          id?: string
          installment_number: number
          paid_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          agreement_id?: string
          amount?: number | null
          created_at?: string
          due_date?: string | null
          id?: string
          installment_number?: number
          paid_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mgmv_installments_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "mgmv_agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          client_id: string
          collection_eligible: boolean
          created_at: string
          due_date: string
          financial_status: string
          id: string
          included_in_mgmv: boolean
          mgmv_agreement_id: string | null
          name: string
          notes: string | null
          paid_value: number
          platform: string
          register_date: string
          situation: string
          total_value: number
          updated_at: string
        }
        Insert: {
          client_id: string
          collection_eligible?: boolean
          created_at?: string
          due_date?: string
          financial_status?: string
          id?: string
          included_in_mgmv?: boolean
          mgmv_agreement_id?: string | null
          name: string
          notes?: string | null
          paid_value?: number
          platform?: string
          register_date?: string
          situation?: string
          total_value?: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          collection_eligible?: boolean
          created_at?: string
          due_date?: string
          financial_status?: string
          id?: string
          included_in_mgmv?: boolean
          mgmv_agreement_id?: string | null
          name?: string
          notes?: string | null
          paid_value?: number
          platform?: string
          register_date?: string
          situation?: string
          total_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      saved_filters: {
        Row: {
          created_at: string
          id: string
          name: string
          payload: Json
          scope: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          payload?: Json
          scope: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          payload?: Json
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
