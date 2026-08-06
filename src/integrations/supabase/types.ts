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
      active_sessions: {
        Row: {
          created_at: string
          last_seen: string
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          last_seen?: string
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          last_seen?: string
          session_id?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_automations: {
        Row: {
          applies_to: string
          created_at: string
          description: string
          env: Database["public"]["Enums"]["app_env"]
          estimated_ai_savings: string
          id: string
          name: string
          python_code: string
          reasoning: string
          sandbox_owner: string | null
          scope: string
          status: string
          trigger: string
          updated_at: string
          user_id: string
        }
        Insert: {
          applies_to?: string
          created_at?: string
          description?: string
          env?: Database["public"]["Enums"]["app_env"]
          estimated_ai_savings?: string
          id?: string
          name: string
          python_code?: string
          reasoning?: string
          sandbox_owner?: string | null
          scope?: string
          status?: string
          trigger?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          applies_to?: string
          created_at?: string
          description?: string
          env?: Database["public"]["Enums"]["app_env"]
          estimated_ai_savings?: string
          id?: string
          name?: string
          python_code?: string
          reasoning?: string
          sandbox_owner?: string | null
          scope?: string
          status?: string
          trigger?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_training_profile: {
        Row: {
          business_facts: Json
          created_at: string
          documents: Json
          env: Database["public"]["Enums"]["app_env"]
          last_analysis_at: string | null
          onboarding_answers: Json
          onboarding_completed: boolean
          sandbox_key: string
          sandbox_owner: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          business_facts?: Json
          created_at?: string
          documents?: Json
          env?: Database["public"]["Enums"]["app_env"]
          last_analysis_at?: string | null
          onboarding_answers?: Json
          onboarding_completed?: boolean
          sandbox_key?: string
          sandbox_owner?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          business_facts?: Json
          created_at?: string
          documents?: Json
          env?: Database["public"]["Enums"]["app_env"]
          last_analysis_at?: string | null
          onboarding_answers?: Json
          onboarding_completed?: boolean
          sandbox_key?: string
          sandbox_owner?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          env: Database["public"]["Enums"]["app_env"]
          id: string
          preferences: Json
          rules: Json
          sandbox_key: string
          sandbox_owner: string | null
          security: Json
          ui_state: Json
          updated_at: string
        }
        Insert: {
          env?: Database["public"]["Enums"]["app_env"]
          id?: string
          preferences?: Json
          rules?: Json
          sandbox_key?: string
          sandbox_owner?: string | null
          security?: Json
          ui_state?: Json
          updated_at?: string
        }
        Update: {
          env?: Database["public"]["Enums"]["app_env"]
          id?: string
          preferences?: Json
          rules?: Json
          sandbox_key?: string
          sandbox_owner?: string | null
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
          env: Database["public"]["Enums"]["app_env"]
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
          env?: Database["public"]["Enums"]["app_env"]
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
          env?: Database["public"]["Enums"]["app_env"]
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
          customer_data: string | null
          env: Database["public"]["Enums"]["app_env"]
          folder: string | null
          id: string
          mgmv: Json | null
          name: string
          notes: string | null
          original_html_checksum: string | null
          original_html_file_name: string | null
          original_html_imported_at: string | null
          original_html_source_folder: string | null
          original_html_storage_path: string | null
          phone: string
          sandbox_owner: string | null
          updated_at: string
        }
        Insert: {
          client_type?: string
          created_at?: string
          customer_data?: string | null
          env?: Database["public"]["Enums"]["app_env"]
          folder?: string | null
          id?: string
          mgmv?: Json | null
          name: string
          notes?: string | null
          original_html_checksum?: string | null
          original_html_file_name?: string | null
          original_html_imported_at?: string | null
          original_html_source_folder?: string | null
          original_html_storage_path?: string | null
          phone?: string
          sandbox_owner?: string | null
          updated_at?: string
        }
        Update: {
          client_type?: string
          created_at?: string
          customer_data?: string | null
          env?: Database["public"]["Enums"]["app_env"]
          folder?: string | null
          id?: string
          mgmv?: Json | null
          name?: string
          notes?: string | null
          original_html_checksum?: string | null
          original_html_file_name?: string | null
          original_html_imported_at?: string | null
          original_html_source_folder?: string | null
          original_html_storage_path?: string | null
          phone?: string
          sandbox_owner?: string | null
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
          env: Database["public"]["Enums"]["app_env"]
          errors: number
          file: string
          file_hash: string | null
          id: string
          products_added: number
          raw_content: string | null
          sandbox_owner: string | null
          skipped_duplicates: number | null
          source: string
          status: string
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          agreements_created?: number | null
          agreements_replaced?: number | null
          clients_created?: number
          created_at?: string
          date?: string
          duration_ms?: number | null
          env?: Database["public"]["Enums"]["app_env"]
          errors?: number
          file: string
          file_hash?: string | null
          id?: string
          products_added?: number
          raw_content?: string | null
          sandbox_owner?: string | null
          skipped_duplicates?: number | null
          source: string
          status: string
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          agreements_created?: number | null
          agreements_replaced?: number | null
          clients_created?: number
          created_at?: string
          date?: string
          duration_ms?: number | null
          env?: Database["public"]["Enums"]["app_env"]
          errors?: number
          file?: string
          file_hash?: string | null
          id?: string
          products_added?: number
          raw_content?: string | null
          sandbox_owner?: string | null
          skipped_duplicates?: number | null
          source?: string
          status?: string
          user_email?: string | null
          user_id?: string | null
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
          completed_at: string | null
          created_at: string
          detection_log: Json | null
          due_day: number | null
          env: Database["public"]["Enums"]["app_env"]
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
          sandbox_owner: string | null
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
          completed_at?: string | null
          created_at?: string
          detection_log?: Json | null
          due_day?: number | null
          env?: Database["public"]["Enums"]["app_env"]
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
          sandbox_owner?: string | null
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
          completed_at?: string | null
          created_at?: string
          detection_log?: Json | null
          due_day?: number | null
          env?: Database["public"]["Enums"]["app_env"]
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
          sandbox_owner?: string | null
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
          env: Database["public"]["Enums"]["app_env"]
          id: string
          installment_number: number
          manual_partial: boolean
          paid_amount: number | null
          paid_at: string | null
          sandbox_owner: string | null
          status: string
          updated_at: string
        }
        Insert: {
          agreement_id: string
          amount?: number | null
          created_at?: string
          due_date?: string | null
          env?: Database["public"]["Enums"]["app_env"]
          id?: string
          installment_number: number
          manual_partial?: boolean
          paid_amount?: number | null
          paid_at?: string | null
          sandbox_owner?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          agreement_id?: string
          amount?: number | null
          created_at?: string
          due_date?: string | null
          env?: Database["public"]["Enums"]["app_env"]
          id?: string
          installment_number?: number
          manual_partial?: boolean
          paid_amount?: number | null
          paid_at?: string | null
          sandbox_owner?: string | null
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
      nf_invoices: {
        Row: {
          client_id: string
          content: string
          created_at: string
          env: Database["public"]["Enums"]["app_env"]
          generated_by: string | null
          id: string
          product_ids: string[]
          sandbox_owner: string | null
          total_cents: number
        }
        Insert: {
          client_id: string
          content: string
          created_at?: string
          env?: Database["public"]["Enums"]["app_env"]
          generated_by?: string | null
          id?: string
          product_ids?: string[]
          sandbox_owner?: string | null
          total_cents?: number
        }
        Update: {
          client_id?: string
          content?: string
          created_at?: string
          env?: Database["public"]["Enums"]["app_env"]
          generated_by?: string | null
          id?: string
          product_ids?: string[]
          sandbox_owner?: string | null
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "nf_invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      notion_html_access_log: {
        Row: {
          action: string
          client_id: string | null
          created_at: string
          file_name: string | null
          id: string
          storage_path: string
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          client_id?: string | null
          created_at?: string
          file_name?: string | null
          id?: string
          storage_path: string
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          client_id?: string | null
          created_at?: string
          file_name?: string | null
          id?: string
          storage_path?: string
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notion_html_access_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      product_ncm: {
        Row: {
          category: string
          confidence: number | null
          created_at: string
          env: Database["public"]["Enums"]["app_env"]
          id: string
          name: string
          name_key: string
          ncm: string
          platform: string
          platform_key: string
          rationale: string | null
          sandbox_owner: string | null
          source: string
          status: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          category?: string
          confidence?: number | null
          created_at?: string
          env?: Database["public"]["Enums"]["app_env"]
          id?: string
          name: string
          name_key: string
          ncm?: string
          platform?: string
          platform_key: string
          rationale?: string | null
          sandbox_owner?: string | null
          source?: string
          status?: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          category?: string
          confidence?: number | null
          created_at?: string
          env?: Database["public"]["Enums"]["app_env"]
          id?: string
          name?: string
          name_key?: string
          ncm?: string
          platform?: string
          platform_key?: string
          rationale?: string | null
          sandbox_owner?: string | null
          source?: string
          status?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      products: {
        Row: {
          client_id: string
          collection_eligible: boolean
          created_at: string
          due_date: string
          env: Database["public"]["Enums"]["app_env"]
          financial_status: string
          id: string
          included_in_mgmv: boolean
          mgmv_agreement_id: string | null
          name: string
          notes: string | null
          paid_value: number
          platform: string
          register_date: string
          sandbox_owner: string | null
          situation: string
          total_value: number
          updated_at: string
        }
        Insert: {
          client_id: string
          collection_eligible?: boolean
          created_at?: string
          due_date?: string
          env?: Database["public"]["Enums"]["app_env"]
          financial_status?: string
          id?: string
          included_in_mgmv?: boolean
          mgmv_agreement_id?: string | null
          name: string
          notes?: string | null
          paid_value?: number
          platform?: string
          register_date?: string
          sandbox_owner?: string | null
          situation?: string
          total_value?: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          collection_eligible?: boolean
          created_at?: string
          due_date?: string
          env?: Database["public"]["Enums"]["app_env"]
          financial_status?: string
          id?: string
          included_in_mgmv?: boolean
          mgmv_agreement_id?: string | null
          name?: string
          notes?: string | null
          paid_value?: number
          platform?: string
          register_date?: string
          sandbox_owner?: string | null
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
          can_receive_tasks: boolean
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          can_receive_tasks?: boolean
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          can_receive_tasks?: boolean
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          created_at: string
          id: string
          permission: Database["public"]["Enums"]["app_permission"]
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          id?: string
          permission: Database["public"]["Enums"]["app_permission"]
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          id?: string
          permission?: Database["public"]["Enums"]["app_permission"]
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      sandbox_import_audit: {
        Row: {
          created_at: string
          duration_ms: number | null
          env: Database["public"]["Enums"]["app_env"]
          error: string | null
          file_name: string | null
          id: string
          mode: string
          production_counts_after: Json
          production_counts_before: Json
          production_untouched: boolean
          report: Json | null
          result: string
          row_counts: Json
          source: string
          tables_affected: string[]
          user_email: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          env?: Database["public"]["Enums"]["app_env"]
          error?: string | null
          file_name?: string | null
          id?: string
          mode: string
          production_counts_after?: Json
          production_counts_before?: Json
          production_untouched?: boolean
          report?: Json | null
          result?: string
          row_counts?: Json
          source: string
          tables_affected?: string[]
          user_email?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          env?: Database["public"]["Enums"]["app_env"]
          error?: string | null
          file_name?: string | null
          id?: string
          mode?: string
          production_counts_after?: Json
          production_counts_before?: Json
          production_untouched?: boolean
          report?: Json | null
          result?: string
          row_counts?: Json
          source?: string
          tables_affected?: string[]
          user_email?: string | null
          user_id?: string
        }
        Relationships: []
      }
      sandbox_state: {
        Row: {
          active: boolean
          cloned_at: string | null
          created_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          cloned_at?: string | null
          created_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          cloned_at?: string | null
          created_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      saved_filters: {
        Row: {
          created_at: string
          created_by: string | null
          env: Database["public"]["Enums"]["app_env"]
          id: string
          name: string
          payload: Json
          sandbox_owner: string | null
          scope: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          env?: Database["public"]["Enums"]["app_env"]
          id?: string
          name: string
          payload?: Json
          sandbox_owner?: string | null
          scope: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          env?: Database["public"]["Enums"]["app_env"]
          id?: string
          name?: string
          payload?: Json
          sandbox_owner?: string | null
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      system_backups: {
        Row: {
          ai_verification: Json | null
          business_summary: Json
          cancel_requested: boolean
          created_at: string
          created_by: string | null
          debug_log: Json
          duration_ms: number | null
          env: Database["public"]["Enums"]["app_env"]
          error: string | null
          error_details: Json | null
          finished_at: string | null
          id: string
          progress: Json
          row_counts: Json
          size_bytes: number | null
          status: string
          storage_object_count: number
          storage_path: string | null
          type: string
          updated_at: string
        }
        Insert: {
          ai_verification?: Json | null
          business_summary?: Json
          cancel_requested?: boolean
          created_at?: string
          created_by?: string | null
          debug_log?: Json
          duration_ms?: number | null
          env?: Database["public"]["Enums"]["app_env"]
          error?: string | null
          error_details?: Json | null
          finished_at?: string | null
          id?: string
          progress?: Json
          row_counts?: Json
          size_bytes?: number | null
          status?: string
          storage_object_count?: number
          storage_path?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          ai_verification?: Json | null
          business_summary?: Json
          cancel_requested?: boolean
          created_at?: string
          created_by?: string | null
          debug_log?: Json
          duration_ms?: number | null
          env?: Database["public"]["Enums"]["app_env"]
          error?: string | null
          error_details?: Json | null
          finished_at?: string | null
          id?: string
          progress?: Json
          row_counts?: Json
          size_bytes?: number | null
          status?: string
          storage_object_count?: number
          storage_path?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      team_punch_entries: {
        Row: {
          created_at: string
          day: string
          env: Database["public"]["Enums"]["app_env"]
          feedback_environment: number | null
          feedback_mood: number | null
          feedback_notes: string | null
          feedback_optimization: string | null
          id: string
          kind: Database["public"]["Enums"]["punch_kind"]
          punched_at: string
          sandbox_owner: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          day?: string
          env?: Database["public"]["Enums"]["app_env"]
          feedback_environment?: number | null
          feedback_mood?: number | null
          feedback_notes?: string | null
          feedback_optimization?: string | null
          id?: string
          kind: Database["public"]["Enums"]["punch_kind"]
          punched_at?: string
          sandbox_owner?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          day?: string
          env?: Database["public"]["Enums"]["app_env"]
          feedback_environment?: number | null
          feedback_mood?: number | null
          feedback_notes?: string | null
          feedback_optimization?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["punch_kind"]
          punched_at?: string
          sandbox_owner?: string | null
          user_id?: string
        }
        Relationships: []
      }
      team_task_activity: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          env: Database["public"]["Enums"]["app_env"]
          id: string
          payload: Json | null
          sandbox_owner: string | null
          task_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          env?: Database["public"]["Enums"]["app_env"]
          id?: string
          payload?: Json | null
          sandbox_owner?: string | null
          task_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          env?: Database["public"]["Enums"]["app_env"]
          id?: string
          payload?: Json | null
          sandbox_owner?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "team_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      team_task_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          env: Database["public"]["Enums"]["app_env"]
          id: string
          kind: string
          sandbox_owner: string | null
          task_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          env?: Database["public"]["Enums"]["app_env"]
          id?: string
          kind?: string
          sandbox_owner?: string | null
          task_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          env?: Database["public"]["Enums"]["app_env"]
          id?: string
          kind?: string
          sandbox_owner?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "team_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      team_tasks: {
        Row: {
          assignee_id: string | null
          checklist: Json
          client_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          due_at: string | null
          env: Database["public"]["Enums"]["app_env"]
          id: string
          linked_entity_id: string | null
          linked_entity_type: string | null
          linked_filter: Json | null
          position: number
          priority: string
          product_id: string | null
          sandbox_owner: string | null
          source: string
          started_at: string | null
          status: string
          tags: string[]
          task_type: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          checklist?: Json
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_at?: string | null
          env?: Database["public"]["Enums"]["app_env"]
          id?: string
          linked_entity_id?: string | null
          linked_entity_type?: string | null
          linked_filter?: Json | null
          position?: number
          priority?: string
          product_id?: string | null
          sandbox_owner?: string | null
          source?: string
          started_at?: string | null
          status?: string
          tags?: string[]
          task_type?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          checklist?: Json
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_at?: string | null
          env?: Database["public"]["Enums"]["app_env"]
          id?: string
          linked_entity_id?: string | null
          linked_entity_type?: string | null
          linked_filter?: Json | null
          position?: number
          priority?: string
          product_id?: string | null
          sandbox_owner?: string | null
          source?: string
          started_at?: string | null
          status?: string
          tags?: string[]
          task_type?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_responsibilities: {
        Row: {
          created_at: string
          id: string
          responsibility: Database["public"]["Enums"]["user_responsibility"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          responsibility: Database["public"]["Enums"]["user_responsibility"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          responsibility?: Database["public"]["Enums"]["user_responsibility"]
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bootstrap_first_admin: { Args: never; Returns: boolean }
      can_access_notion_html_originals: {
        Args: { _user_id: string }
        Returns: boolean
      }
      can_assign_to: {
        Args: { _assignee: string; _assigner: string }
        Returns: boolean
      }
      can_view_team_tasks: { Args: { _user_id: string }; Returns: boolean }
      complete_mgmv_agreement: { Args: { _client_id: string }; Returns: Json }
      count_env_rows: {
        Args: {
          _env: Database["public"]["Enums"]["app_env"]
          _owner?: string
          _table: string
        }
        Returns: number
      }
      current_env: {
        Args: never
        Returns: Database["public"]["Enums"]["app_env"]
      }
      env_row_visible: {
        Args: { _env: Database["public"]["Enums"]["app_env"]; _owner: string }
        Returns: boolean
      }
      export_db_schema_snapshot: { Args: never; Returns: Json }
      get_system_backup_schedule: {
        Args: never
        Returns: {
          active: boolean
          jobid: number
          schedule: string
        }[]
      }
      has_any_internal_role: { Args: { _user_id: string }; Returns: boolean }
      has_permission: {
        Args: {
          _permission: Database["public"]["Enums"]["app_permission"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      list_online_users: {
        Args: { _window_seconds?: number }
        Returns: {
          display_name: string
          last_seen: string
          user_email: string
          user_id: string
        }[]
      }
      product_catalog: {
        Args: {
          _only_missing_ncm?: boolean
          _page?: number
          _page_size?: number
          _platform?: string
          _search?: string
          _sort?: string
        }
        Returns: {
          name: string
          ncm: string
          ncm_category: string
          ncm_confidence: number
          ncm_rationale: string
          ncm_source: string
          ncm_status: string
          open_qty: number
          paid_qty: number
          paid_value: number
          platform: string
          total_count: number
          total_qty: number
          total_value: number
        }[]
      }
      product_reports: { Args: { _limit?: number }; Returns: Json }
      set_system_backup_schedule: {
        Args: {
          _frequency: string
          _hour?: number
          _job_name: string
          _minute?: number
          _weekday?: number
        }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      team_usage_stats: {
        Args: { _days?: number }
        Returns: {
          active_blocks: number
          active_days: number
          by_table: Json
          daily: Json
          deletes: number
          inserts: number
          last_action_at: string
          total_actions: number
          updates: number
          user_email: string
          user_id: string
        }[]
      }
    }
    Enums: {
      app_env: "producao" | "sandbox"
      app_permission:
        | "dashboard.view"
        | "clientes.view"
        | "clientes.edit"
        | "collection.view"
        | "collection.edit"
        | "mgmv.view"
        | "mgmv.edit"
        | "import.use"
        | "finance.view"
        | "settings.view"
        | "users.manage"
        | "team.view"
        | "team.assign.all"
        | "team.assign.team"
        | "team.task.update_own"
        | "team.task.comment"
        | "punch.clock"
        | "shipping.mark_sent"
        | "mgmv.register_product"
      app_role:
        | "admin"
        | "manager"
        | "operator"
        | "viewer"
        | "admin_master"
        | "gerente"
        | "supervisor"
        | "funcionario"
        | "envio"
        | "mgmv"
      punch_kind: "in" | "lunch_out" | "lunch_in" | "out"
      user_responsibility:
        | "cobranca"
        | "mgmv"
        | "envio"
        | "importacao"
        | "revisao_ia"
        | "cadastro"
        | "financeiro"
        | "atendimento"
        | "leiloes"
        | "admin"
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
    Enums: {
      app_env: ["producao", "sandbox"],
      app_permission: [
        "dashboard.view",
        "clientes.view",
        "clientes.edit",
        "collection.view",
        "collection.edit",
        "mgmv.view",
        "mgmv.edit",
        "import.use",
        "finance.view",
        "settings.view",
        "users.manage",
        "team.view",
        "team.assign.all",
        "team.assign.team",
        "team.task.update_own",
        "team.task.comment",
        "punch.clock",
        "shipping.mark_sent",
        "mgmv.register_product",
      ],
      app_role: [
        "admin",
        "manager",
        "operator",
        "viewer",
        "admin_master",
        "gerente",
        "supervisor",
        "funcionario",
        "envio",
        "mgmv",
      ],
      punch_kind: ["in", "lunch_out", "lunch_in", "out"],
      user_responsibility: [
        "cobranca",
        "mgmv",
        "envio",
        "importacao",
        "revisao_ia",
        "cadastro",
        "financeiro",
        "atendimento",
        "leiloes",
        "admin",
      ],
    },
  },
} as const
