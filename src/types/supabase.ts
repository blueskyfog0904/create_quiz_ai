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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string
          amount: number | null
          created_at: string
          details: Json
          id: string
          reason: string | null
          request_id: string | null
          target_id: string | null
          target_type: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id: string
          amount?: number | null
          created_at?: string
          details?: Json
          id?: string
          reason?: string | null
          request_id?: string | null
          target_id?: string | null
          target_type?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string
          amount?: number | null
          created_at?: string
          details?: Json
          id?: string
          reason?: string | null
          request_id?: string | null
          target_id?: string | null
          target_type?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      admin_event_deliveries: {
        Row: {
          attempt_count: number
          channel: string | null
          delivered_at: string | null
          event_id: string
          gave_up_at: string | null
          last_error: string | null
          request_id: number | null
          requested_at: string | null
        }
        Insert: {
          attempt_count?: number
          channel?: string | null
          delivered_at?: string | null
          event_id: string
          gave_up_at?: string | null
          last_error?: string | null
          request_id?: number | null
          requested_at?: string | null
        }
        Update: {
          attempt_count?: number
          channel?: string | null
          delivered_at?: string | null
          event_id?: string
          gave_up_at?: string | null
          last_error?: string | null
          request_id?: number | null
          requested_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_event_deliveries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "admin_events"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_event_dispatch_state: {
        Row: {
          id: boolean
          last_heartbeat_at: string | null
          last_run_at: string | null
          last_run_error: string | null
          last_success_at: string | null
        }
        Insert: {
          id?: boolean
          last_heartbeat_at?: string | null
          last_run_at?: string | null
          last_run_error?: string | null
          last_success_at?: string | null
        }
        Update: {
          id?: boolean
          last_heartbeat_at?: string | null
          last_run_at?: string | null
          last_run_error?: string | null
          last_success_at?: string | null
        }
        Relationships: []
      }
      admin_event_reads: {
        Row: {
          admin_id: string
          last_seen_at: string | null
        }
        Insert: {
          admin_id: string
          last_seen_at?: string | null
        }
        Update: {
          admin_id?: string
          last_seen_at?: string | null
        }
        Relationships: []
      }
      admin_events: {
        Row: {
          body: string | null
          created_at: string
          dedupe_key: string | null
          delivery: string
          id: string
          kind: string
          link: string
          ref_id: string | null
          ref_table: string | null
          required_permission: string
          severity: string
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          delivery?: string
          id?: string
          kind: string
          link: string
          ref_id?: string | null
          ref_table?: string | null
          required_permission: string
          severity: string
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          delivery?: string
          id?: string
          kind?: string
          link?: string
          ref_id?: string | null
          ref_table?: string | null
          required_permission?: string
          severity?: string
          title?: string
        }
        Relationships: []
      }
      admin_permission_grants: {
        Row: {
          granted_at: string
          granted_by: string
          limits: Json
          permission: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by: string
          limits?: Json
          permission: string
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string
          limits?: Json
          permission?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_permission_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_models: {
        Row: {
          created_at: string
          display_order: number
          id: string
          name: string
          provider: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          name: string
          provider: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          name?: string
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_provider_connections: {
        Row: {
          anthropic_version: string | null
          api_key_last4: string | null
          base_url: string | null
          created_at: string
          display_name: string
          encrypted_api_key: string | null
          id: string
          is_enabled: boolean
          last_error: string | null
          last_test_status: string | null
          last_tested_at: string | null
          organization_id: string | null
          project_id: string | null
          provider: string
          updated_at: string
        }
        Insert: {
          anthropic_version?: string | null
          api_key_last4?: string | null
          base_url?: string | null
          created_at?: string
          display_name: string
          encrypted_api_key?: string | null
          id?: string
          is_enabled?: boolean
          last_error?: string | null
          last_test_status?: string | null
          last_tested_at?: string | null
          organization_id?: string | null
          project_id?: string | null
          provider: string
          updated_at?: string
        }
        Update: {
          anthropic_version?: string | null
          api_key_last4?: string | null
          base_url?: string | null
          created_at?: string
          display_name?: string
          encrypted_api_key?: string | null
          id?: string
          is_enabled?: boolean
          last_error?: string | null
          last_test_status?: string | null
          last_tested_at?: string | null
          organization_id?: string | null
          project_id?: string | null
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_question_generation_runs: {
        Row: {
          attempts: Json
          created_at: string
          credit_charged: number
          duration_ms: number | null
          expires_at: string | null
          failure_category: string | null
          failure_class: string | null
          failure_code: string | null
          failure_phase: string | null
          final_question: Json | null
          final_review: Json | null
          id: string
          input: Json
          last_question: Json | null
          listboard_job_id: string | null
          listboard_job_item_id: string | null
          model_config: Json
          problem_type_id: string | null
          problem_type_name: string | null
          question_id: string | null
          redaction_flags: Json
          retry_count: number
          source: string
          status: string
          stop_reason: string | null
          truncated_flags: Json
          user_id: string | null
          workspace_subject: string
        }
        Insert: {
          attempts?: Json
          created_at?: string
          credit_charged?: number
          duration_ms?: number | null
          expires_at?: string | null
          failure_category?: string | null
          failure_class?: string | null
          failure_code?: string | null
          failure_phase?: string | null
          final_question?: Json | null
          final_review?: Json | null
          id?: string
          input?: Json
          last_question?: Json | null
          listboard_job_id?: string | null
          listboard_job_item_id?: string | null
          model_config?: Json
          problem_type_id?: string | null
          problem_type_name?: string | null
          question_id?: string | null
          redaction_flags?: Json
          retry_count?: number
          source: string
          status: string
          stop_reason?: string | null
          truncated_flags?: Json
          user_id?: string | null
          workspace_subject?: string
        }
        Update: {
          attempts?: Json
          created_at?: string
          credit_charged?: number
          duration_ms?: number | null
          expires_at?: string | null
          failure_category?: string | null
          failure_class?: string | null
          failure_code?: string | null
          failure_phase?: string | null
          final_question?: Json | null
          final_review?: Json | null
          id?: string
          input?: Json
          last_question?: Json | null
          listboard_job_id?: string | null
          listboard_job_item_id?: string | null
          model_config?: Json
          problem_type_id?: string | null
          problem_type_name?: string | null
          question_id?: string | null
          redaction_flags?: Json
          retry_count?: number
          source?: string
          status?: string
          stop_reason?: string | null
          truncated_flags?: Json
          user_id?: string | null
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_question_generation_runs_listboard_job_id_fkey"
            columns: ["listboard_job_id"]
            isOneToOne: false
            referencedRelation: "generate_listboard_generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_question_generation_runs_listboard_job_item_id_fkey"
            columns: ["listboard_job_item_id"]
            isOneToOne: false
            referencedRelation: "generate_listboard_generation_job_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_question_generation_runs_problem_type_id_fkey"
            columns: ["problem_type_id"]
            isOneToOne: false
            referencedRelation: "problem_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_question_generation_runs_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      checkout_attempts: {
        Row: {
          checkout_attempt_id: string
          claimed_provider: string
          created_at: string
          expires_at: string
          id: string
          payment_order_id: string | null
          plan_id: string
          request_fingerprint: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          checkout_attempt_id: string
          claimed_provider: string
          created_at?: string
          expires_at: string
          id?: string
          payment_order_id?: string | null
          plan_id: string
          request_fingerprint: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          checkout_attempt_id?: string
          claimed_provider?: string
          created_at?: string
          expires_at?: string
          id?: string
          payment_order_id?: string | null
          plan_id?: string
          request_fingerprint?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkout_attempts_payment_order_id_fkey"
            columns: ["payment_order_id"]
            isOneToOne: true
            referencedRelation: "payment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_attempts_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "pricing_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_consumption: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          id: string
          operation_key: string | null
          resource_id: string | null
          resource_type: string | null
          source_id: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          operation_key?: string | null
          resource_id?: string | null
          resource_type?: string | null
          source_id: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          operation_key?: string | null
          resource_id?: string | null
          resource_type?: string | null
          source_id?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_consumption_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "credit_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_consumption_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "credit_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_consumption_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_sources: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          initial_credits: number
          payment_order_id: string | null
          plan_id: string | null
          purchased_at: string
          remaining_credits: number
          source_category: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          initial_credits: number
          payment_order_id?: string | null
          plan_id?: string | null
          purchased_at?: string
          remaining_credits: number
          source_category?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          initial_credits?: number
          payment_order_id?: string | null
          plan_id?: string | null
          purchased_at?: string
          remaining_credits?: number
          source_category?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_sources_payment_order_id_fkey"
            columns: ["payment_order_id"]
            isOneToOne: false
            referencedRelation: "payment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_sources_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "pricing_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_sources_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          description: string | null
          id: string
          operation_key: string | null
          original_operation_key: string | null
          resource_id: string | null
          resource_type: string | null
          source_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          description?: string | null
          id?: string
          operation_key?: string | null
          original_operation_key?: string | null
          resource_id?: string | null
          resource_type?: string | null
          source_id?: string | null
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          description?: string | null
          id?: string
          operation_key?: string | null
          original_operation_key?: string | null
          resource_id?: string | null
          resource_type?: string | null
          source_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "credit_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      display_labels: {
        Row: {
          category: string
          created_at: string | null
          db_value: string
          display_value: string
          id: string
          sort_order: number | null
          updated_at: string | null
          workspace_subject: string
        }
        Insert: {
          category: string
          created_at?: string | null
          db_value: string
          display_value: string
          id?: string
          sort_order?: number | null
          updated_at?: string | null
          workspace_subject?: string
        }
        Update: {
          category?: string
          created_at?: string | null
          db_value?: string
          display_value?: string
          id?: string
          sort_order?: number | null
          updated_at?: string | null
          workspace_subject?: string
        }
        Relationships: []
      }
      exam_paper_items: {
        Row: {
          created_at: string
          exam_paper_id: string
          id: string
          number: number
          order_index: number
          question_id: string
          workspace_subject: string
        }
        Insert: {
          created_at?: string
          exam_paper_id: string
          id?: string
          number: number
          order_index: number
          question_id: string
          workspace_subject?: string
        }
        Update: {
          created_at?: string
          exam_paper_id?: string
          id?: string
          number?: number
          order_index?: number
          question_id?: string
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_paper_items_exam_paper_id_fkey"
            columns: ["exam_paper_id"]
            isOneToOne: false
            referencedRelation: "exam_papers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_paper_items_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_papers: {
        Row: {
          created_at: string
          description: string | null
          generation_criteria: Json | null
          generation_mode: string | null
          id: string
          paper_title: string
          updated_at: string
          user_id: string
          workspace_subject: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          generation_criteria?: Json | null
          generation_mode?: string | null
          id?: string
          paper_title: string
          updated_at?: string
          user_id: string
          workspace_subject?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          generation_criteria?: Json | null
          generation_mode?: string | null
          id?: string
          paper_title?: string
          updated_at?: string
          user_id?: string
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_papers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      generate_listboard_generation_job_events: {
        Row: {
          attempt_id: string | null
          claim_token: string | null
          created_at: string
          event_type: string
          id: string
          job_id: string
          job_item_id: string | null
          message: string | null
          metadata: Json
          request_id: string | null
          severity: string
          status_from: string | null
          status_to: string | null
          user_id: string | null
          workspace_subject: string
        }
        Insert: {
          attempt_id?: string | null
          claim_token?: string | null
          created_at?: string
          event_type: string
          id?: string
          job_id: string
          job_item_id?: string | null
          message?: string | null
          metadata?: Json
          request_id?: string | null
          severity?: string
          status_from?: string | null
          status_to?: string | null
          user_id?: string | null
          workspace_subject?: string
        }
        Update: {
          attempt_id?: string | null
          claim_token?: string | null
          created_at?: string
          event_type?: string
          id?: string
          job_id?: string
          job_item_id?: string | null
          message?: string | null
          metadata?: Json
          request_id?: string | null
          severity?: string
          status_from?: string | null
          status_to?: string | null
          user_id?: string | null
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "generate_listboard_generation_job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "generate_listboard_generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generate_listboard_generation_job_events_job_item_id_fkey"
            columns: ["job_item_id"]
            isOneToOne: false
            referencedRelation: "generate_listboard_generation_job_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generate_listboard_generation_job_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      generate_listboard_generation_job_items: {
        Row: {
          attempt_count: number
          attempt_id: string | null
          claim_token: string | null
          created_at: string
          credit_charge_operation_key: string | null
          credit_charged: number
          credit_charged_at: string | null
          credit_consumptions: Json
          credit_refund_operation_key: string | null
          credit_refund_transaction_id: string | null
          credit_refunded_at: string | null
          credit_transaction_id: string | null
          error_code: string | null
          error_message: string | null
          finished_at: string | null
          generated_question: Json | null
          id: string
          job_id: string
          last_heartbeat_at: string | null
          last_run_error_code: string | null
          last_run_error_message: string | null
          leased_until: string | null
          post_id: string
          post_item_id: string
          problem_type_id: string
          question_id: string | null
          raw_ai_response: string | null
          save_claim_token: string | null
          save_error_message: string | null
          save_leased_until: string | null
          save_status: string
          saved_at: string | null
          started_at: string | null
          status: string
          updated_at: string
          workspace_subject: string
        }
        Insert: {
          attempt_count?: number
          attempt_id?: string | null
          claim_token?: string | null
          created_at?: string
          credit_charge_operation_key?: string | null
          credit_charged?: number
          credit_charged_at?: string | null
          credit_consumptions?: Json
          credit_refund_operation_key?: string | null
          credit_refund_transaction_id?: string | null
          credit_refunded_at?: string | null
          credit_transaction_id?: string | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          generated_question?: Json | null
          id?: string
          job_id: string
          last_heartbeat_at?: string | null
          last_run_error_code?: string | null
          last_run_error_message?: string | null
          leased_until?: string | null
          post_id: string
          post_item_id: string
          problem_type_id: string
          question_id?: string | null
          raw_ai_response?: string | null
          save_claim_token?: string | null
          save_error_message?: string | null
          save_leased_until?: string | null
          save_status?: string
          saved_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          workspace_subject?: string
        }
        Update: {
          attempt_count?: number
          attempt_id?: string | null
          claim_token?: string | null
          created_at?: string
          credit_charge_operation_key?: string | null
          credit_charged?: number
          credit_charged_at?: string | null
          credit_consumptions?: Json
          credit_refund_operation_key?: string | null
          credit_refund_transaction_id?: string | null
          credit_refunded_at?: string | null
          credit_transaction_id?: string | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          generated_question?: Json | null
          id?: string
          job_id?: string
          last_heartbeat_at?: string | null
          last_run_error_code?: string | null
          last_run_error_message?: string | null
          leased_until?: string | null
          post_id?: string
          post_item_id?: string
          problem_type_id?: string
          question_id?: string | null
          raw_ai_response?: string | null
          save_claim_token?: string | null
          save_error_message?: string | null
          save_leased_until?: string | null
          save_status?: string
          saved_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "generate_listboard_generation_credit_refund_transaction_id_fkey"
            columns: ["credit_refund_transaction_id"]
            isOneToOne: false
            referencedRelation: "credit_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generate_listboard_generation_job_it_credit_transaction_id_fkey"
            columns: ["credit_transaction_id"]
            isOneToOne: false
            referencedRelation: "credit_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generate_listboard_generation_job_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "generate_listboard_generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generate_listboard_generation_job_items_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "generate_listboard_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generate_listboard_generation_job_items_post_item_id_fkey"
            columns: ["post_item_id"]
            isOneToOne: false
            referencedRelation: "generate_listboard_post_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generate_listboard_generation_job_items_problem_type_id_fkey"
            columns: ["problem_type_id"]
            isOneToOne: false
            referencedRelation: "problem_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generate_listboard_generation_job_items_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      generate_listboard_generation_jobs: {
        Row: {
          cancelled_count: number
          completed_count: number
          created_at: string
          credit_charged: number
          credit_reserved: number
          difficulty: string | null
          failed_count: number
          finished_at: string | null
          grade_level: string | null
          id: string
          last_error_code: string | null
          last_error_message: string | null
          last_recovered_at: string | null
          last_run_at: string | null
          post_id: string
          requested_generation_count: number
          requested_item_count: number
          requested_type_count: number
          selected_problem_type_ids: string[]
          selection_hash: string | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
          workspace_subject: string
        }
        Insert: {
          cancelled_count?: number
          completed_count?: number
          created_at?: string
          credit_charged?: number
          credit_reserved?: number
          difficulty?: string | null
          failed_count?: number
          finished_at?: string | null
          grade_level?: string | null
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          last_recovered_at?: string | null
          last_run_at?: string | null
          post_id: string
          requested_generation_count?: number
          requested_item_count?: number
          requested_type_count?: number
          selected_problem_type_ids?: string[]
          selection_hash?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
          workspace_subject?: string
        }
        Update: {
          cancelled_count?: number
          completed_count?: number
          created_at?: string
          credit_charged?: number
          credit_reserved?: number
          difficulty?: string | null
          failed_count?: number
          finished_at?: string | null
          grade_level?: string | null
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          last_recovered_at?: string | null
          last_run_at?: string | null
          post_id?: string
          requested_generation_count?: number
          requested_item_count?: number
          requested_type_count?: number
          selected_problem_type_ids?: string[]
          selection_hash?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "generate_listboard_generation_jobs_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "generate_listboard_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generate_listboard_generation_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      generate_listboard_post_items: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          is_active: boolean
          passage_text: string
          post_id: string
          question_number: string
          sort_order: number
          updated_at: string
          updated_by: string | null
          workspace_subject: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          passage_text: string
          post_id: string
          question_number: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          workspace_subject?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          passage_text?: string
          post_id?: string
          question_number?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "generate_listboard_post_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generate_listboard_post_items_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "generate_listboard_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generate_listboard_post_items_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      generate_listboard_posts: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          exam_month: number | null
          exam_year: number | null
          grade_level: string | null
          id: string
          is_active: boolean
          menu_entry_id: string
          passage_text: string
          published_at: string | null
          source_1: string | null
          source_2: string | null
          source_3: string | null
          source_4: string | null
          source_type: string | null
          status: string
          title: string
          updated_at: string
          updated_by: string | null
          workspace_subject: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          exam_month?: number | null
          exam_year?: number | null
          grade_level?: string | null
          id?: string
          is_active?: boolean
          menu_entry_id: string
          passage_text: string
          published_at?: string | null
          source_1?: string | null
          source_2?: string | null
          source_3?: string | null
          source_4?: string | null
          source_type?: string | null
          status?: string
          title: string
          updated_at?: string
          updated_by?: string | null
          workspace_subject?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          exam_month?: number | null
          exam_year?: number | null
          grade_level?: string | null
          id?: string
          is_active?: boolean
          menu_entry_id?: string
          passage_text?: string
          published_at?: string | null
          source_1?: string | null
          source_2?: string | null
          source_3?: string | null
          source_4?: string | null
          source_type?: string | null
          status?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "generate_listboard_posts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generate_listboard_posts_menu_entry_id_fkey"
            columns: ["menu_entry_id"]
            isOneToOne: false
            referencedRelation: "generate_menu_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generate_listboard_posts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      generate_menu_entries: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          entry_key: string
          entry_type: string
          id: string
          is_active: boolean
          is_visible: boolean
          search_config: Json
          slug: string
          sort_order: number
          subject_code: string
          title: string
          updated_at: string
          workspace_subject: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          entry_key: string
          entry_type: string
          id?: string
          is_active?: boolean
          is_visible?: boolean
          search_config?: Json
          slug: string
          sort_order?: number
          subject_code?: string
          title: string
          updated_at?: string
          workspace_subject?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          entry_key?: string
          entry_type?: string
          id?: string
          is_active?: boolean
          is_visible?: boolean
          search_config?: Json
          slug?: string
          sort_order?: number
          subject_code?: string
          title?: string
          updated_at?: string
          workspace_subject?: string
        }
        Relationships: []
      }
      market_bundle_line_components: {
        Row: {
          backfilled: boolean
          category_slug: string
          created_at: string
          line_id: string
          list_price_credits: number
          order_id: string
          subproduct_id: string
        }
        Insert: {
          backfilled?: boolean
          category_slug: string
          created_at?: string
          line_id: string
          list_price_credits: number
          order_id: string
          subproduct_id: string
        }
        Update: {
          backfilled?: boolean
          category_slug?: string
          created_at?: string
          line_id?: string
          list_price_credits?: number
          order_id?: string
          subproduct_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_bundle_line_components_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "market_purchase_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      market_cart_items: {
        Row: {
          bundle_option_id: string | null
          created_at: string
          id: string
          is_selected: boolean
          subproduct_id: string | null
          target_kind: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bundle_option_id?: string | null
          created_at?: string
          id?: string
          is_selected?: boolean
          subproduct_id?: string | null
          target_kind: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bundle_option_id?: string | null
          created_at?: string
          id?: string
          is_selected?: boolean
          subproduct_id?: string | null
          target_kind?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_cart_items_bundle_option_id_fkey"
            columns: ["bundle_option_id"]
            isOneToOne: false
            referencedRelation: "market_item_bundle_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_cart_items_subproduct_id_fkey"
            columns: ["subproduct_id"]
            isOneToOne: false
            referencedRelation: "market_item_subproducts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_cart_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      market_category_items: {
        Row: {
          created_at: string
          default_image_id: string | null
          depth: number
          id: string
          is_active: boolean
          parent_id: string | null
          sort_order: number
          title: string
          updated_at: string
          workspace_subject: string
          effective_default_image: {
            bytes: number
            content_sha256: string
            created_at: string
            created_by: string | null
            display_name: string
            folder_id: string | null
            height: number
            id: string
            mime_type: string
            source_sha256: string
            storage_path: string
            width: number
          } | null
        }
        Insert: {
          created_at?: string
          default_image_id?: string | null
          depth: number
          id?: string
          is_active?: boolean
          parent_id?: string | null
          sort_order?: number
          title: string
          updated_at?: string
          workspace_subject: string
        }
        Update: {
          created_at?: string
          default_image_id?: string | null
          depth?: number
          id?: string
          is_active?: boolean
          parent_id?: string | null
          sort_order?: number
          title?: string
          updated_at?: string
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_category_items_default_image_id_fkey"
            columns: ["default_image_id"]
            isOneToOne: false
            referencedRelation: "market_images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_category_items_parent_subject_fkey"
            columns: ["parent_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "market_category_items"
            referencedColumns: ["id", "workspace_subject"]
          },
        ]
      }
      market_checkout_batches: {
        Row: {
          created_at: string
          id: string
          idempotency_key: string
          mode: string
          request_payload: Json
          result_payload: Json
          total_credits: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          idempotency_key: string
          mode: string
          request_payload: Json
          result_payload: Json
          total_credits: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          idempotency_key?: string
          mode?: string
          request_payload?: Json
          result_payload?: Json
          total_credits?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_checkout_batches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      market_download_events: {
        Row: {
          asset_kind: string
          created_at: string
          entitlement_id: string | null
          event_target_type: string | null
          file_id: string | null
          id: string
          ip_address: string | null
          item_id: string
          order_id: string | null
          purchase_id: string | null
          signed_url_expires_at: string | null
          subproduct_file_id: string | null
          user_agent: string | null
          user_id: string
          workspace_subject: string
        }
        Insert: {
          asset_kind: string
          created_at?: string
          entitlement_id?: string | null
          event_target_type?: string | null
          file_id?: string | null
          id?: string
          ip_address?: string | null
          item_id: string
          order_id?: string | null
          purchase_id?: string | null
          signed_url_expires_at?: string | null
          subproduct_file_id?: string | null
          user_agent?: string | null
          user_id: string
          workspace_subject?: string
        }
        Update: {
          asset_kind?: string
          created_at?: string
          entitlement_id?: string | null
          event_target_type?: string | null
          file_id?: string | null
          id?: string
          ip_address?: string | null
          item_id?: string
          order_id?: string | null
          purchase_id?: string | null
          signed_url_expires_at?: string | null
          subproduct_file_id?: string | null
          user_agent?: string | null
          user_id?: string
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_download_events_entitlement_id_fkey"
            columns: ["entitlement_id"]
            isOneToOne: false
            referencedRelation: "market_entitlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_download_events_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "market_item_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_download_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "market_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_download_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "market_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_download_events_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "market_purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_download_events_subproduct_file_id_fkey"
            columns: ["subproduct_file_id"]
            isOneToOne: false
            referencedRelation: "market_subproduct_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_download_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      market_entitlements: {
        Row: {
          created_at: string
          file_id: string | null
          id: string
          item_id: string
          legacy_asset_kind: string | null
          scope: string
          source_order_id: string | null
          source_purchase_id: string | null
          status: string
          subproduct_id: string | null
          updated_at: string
          user_id: string
          workspace_subject: string
        }
        Insert: {
          created_at?: string
          file_id?: string | null
          id?: string
          item_id: string
          legacy_asset_kind?: string | null
          scope: string
          source_order_id?: string | null
          source_purchase_id?: string | null
          status?: string
          subproduct_id?: string | null
          updated_at?: string
          user_id: string
          workspace_subject: string
        }
        Update: {
          created_at?: string
          file_id?: string | null
          id?: string
          item_id?: string
          legacy_asset_kind?: string | null
          scope?: string
          source_order_id?: string | null
          source_purchase_id?: string | null
          status?: string
          subproduct_id?: string | null
          updated_at?: string
          user_id?: string
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_entitlements_file_workspace_fkey"
            columns: ["file_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "market_subproduct_files"
            referencedColumns: ["id", "workspace_subject"]
          },
          {
            foreignKeyName: "market_entitlements_item_workspace_fkey"
            columns: ["item_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "market_items"
            referencedColumns: ["id", "workspace_subject"]
          },
          {
            foreignKeyName: "market_entitlements_order_workspace_fkey"
            columns: ["source_order_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "market_purchase_orders"
            referencedColumns: ["id", "workspace_subject"]
          },
          {
            foreignKeyName: "market_entitlements_source_purchase_id_fkey"
            columns: ["source_purchase_id"]
            isOneToOne: false
            referencedRelation: "market_purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_entitlements_subproduct_workspace_fkey"
            columns: ["subproduct_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "market_item_subproducts"
            referencedColumns: ["id", "workspace_subject"]
          },
          {
            foreignKeyName: "market_entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      market_file_types: {
        Row: {
          code: string
          created_at: string
          deleted_at: string | null
          extension: string
          id: string
          is_active: boolean
          label: string
          mime_allowlist: string[]
          required_program: string | null
          sort_order: number
          updated_at: string
          workspace_subject: string
        }
        Insert: {
          code: string
          created_at?: string
          deleted_at?: string | null
          extension: string
          id?: string
          is_active?: boolean
          label: string
          mime_allowlist?: string[]
          required_program?: string | null
          sort_order?: number
          updated_at?: string
          workspace_subject: string
        }
        Update: {
          code?: string
          created_at?: string
          deleted_at?: string | null
          extension?: string
          id?: string
          is_active?: boolean
          label?: string
          mime_allowlist?: string[]
          required_program?: string | null
          sort_order?: number
          updated_at?: string
          workspace_subject?: string
        }
        Relationships: []
      }
      market_image_folders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_image_folders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      market_images: {
        Row: {
          bytes: number
          content_sha256: string
          created_at: string
          created_by: string | null
          display_name: string
          folder_id: string | null
          height: number
          id: string
          mime_type: string
          source_sha256: string
          storage_path: string
          width: number
        }
        Insert: {
          bytes: number
          content_sha256: string
          created_at?: string
          created_by?: string | null
          display_name: string
          folder_id?: string | null
          height: number
          id?: string
          mime_type?: string
          source_sha256: string
          storage_path: string
          width: number
        }
        Update: {
          bytes?: number
          content_sha256?: string
          created_at?: string
          created_by?: string | null
          display_name?: string
          folder_id?: string | null
          height?: number
          id?: string
          mime_type?: string
          source_sha256?: string
          storage_path?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "market_images_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_images_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "market_image_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      market_item_bundle_options: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          item_id: string
          label: string
          price_credits: number
          updated_at: string
          workspace_subject: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          item_id: string
          label?: string
          price_credits?: number
          updated_at?: string
          workspace_subject: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          item_id?: string
          label?: string
          price_credits?: number
          updated_at?: string
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_item_bundle_options_item_workspace_fkey"
            columns: ["item_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "market_items"
            referencedColumns: ["id", "workspace_subject"]
          },
        ]
      }
      market_item_files: {
        Row: {
          asset_kind: string
          checksum: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          file_size_bytes: number | null
          id: string
          is_active: boolean
          item_id: string
          mime_type: string | null
          original_file_name: string
          storage_bucket: string
          storage_path: string
          updated_at: string
          version: number
          workspace_subject: string
        }
        Insert: {
          asset_kind: string
          checksum?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          file_size_bytes?: number | null
          id?: string
          is_active?: boolean
          item_id: string
          mime_type?: string | null
          original_file_name: string
          storage_bucket: string
          storage_path: string
          updated_at?: string
          version?: number
          workspace_subject?: string
        }
        Update: {
          asset_kind?: string
          checksum?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          file_size_bytes?: number | null
          id?: string
          is_active?: boolean
          item_id?: string
          mime_type?: string | null
          original_file_name?: string
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          version?: number
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_item_files_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_item_files_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "market_items"
            referencedColumns: ["id"]
          },
        ]
      }
      market_item_review_votes: {
        Row: {
          created_at: string
          id: string
          review_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          review_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          review_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_item_review_votes_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "market_item_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      market_item_reviews: {
        Row: {
          content: string | null
          created_at: string
          deleted_at: string | null
          id: string
          item_id: string
          rating: number
          tag_ids: string[]
          updated_at: string
          user_id: string
          workspace_subject: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          item_id: string
          rating: number
          tag_ids?: string[]
          updated_at?: string
          user_id: string
          workspace_subject: string
        }
        Update: {
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          item_id?: string
          rating?: number
          tag_ids?: string[]
          updated_at?: string
          user_id?: string
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_item_reviews_item_workspace_fkey"
            columns: ["item_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "market_items"
            referencedColumns: ["id", "workspace_subject"]
          },
          {
            foreignKeyName: "market_item_reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      market_item_sample_pages: {
        Row: {
          committed_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          display_order: number
          draft_token: string | null
          file_size_bytes: number
          height_px: number | null
          id: string
          is_active: boolean
          item_id: string
          mime_type: string
          original_file_name: string
          page_number: number
          source_batch_id: string | null
          source_file_id: string | null
          status: string
          storage_bucket: string
          storage_path: string
          version: number
          width_px: number | null
          workspace_subject: string
        }
        Insert: {
          committed_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          display_order?: number
          draft_token?: string | null
          file_size_bytes: number
          height_px?: number | null
          id?: string
          is_active?: boolean
          item_id: string
          mime_type?: string
          original_file_name: string
          page_number: number
          source_batch_id?: string | null
          source_file_id?: string | null
          status?: string
          storage_bucket: string
          storage_path: string
          version?: number
          width_px?: number | null
          workspace_subject?: string
        }
        Update: {
          committed_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          display_order?: number
          draft_token?: string | null
          file_size_bytes?: number
          height_px?: number | null
          id?: string
          is_active?: boolean
          item_id?: string
          mime_type?: string
          original_file_name?: string
          page_number?: number
          source_batch_id?: string | null
          source_file_id?: string | null
          status?: string
          storage_bucket?: string
          storage_path?: string
          version?: number
          width_px?: number | null
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_item_sample_pages_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "market_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_item_sample_pages_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "market_item_files"
            referencedColumns: ["id"]
          },
        ]
      }
      market_item_subproducts: {
        Row: {
          category_id: string
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          is_active: boolean
          item_id: string
          price_credits: number
          purchase_notice_label: string | null
          purchase_notice_text: string | null
          sort_order: number
          title: string
          updated_at: string
          workspace_subject: string
        }
        Insert: {
          category_id: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          item_id: string
          price_credits?: number
          purchase_notice_label?: string | null
          purchase_notice_text?: string | null
          sort_order?: number
          title: string
          updated_at?: string
          workspace_subject: string
        }
        Update: {
          category_id?: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          item_id?: string
          price_credits?: number
          purchase_notice_label?: string | null
          purchase_notice_text?: string | null
          sort_order?: number
          title?: string
          updated_at?: string
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_item_subproducts_category_workspace_fkey"
            columns: ["category_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "market_subproduct_categories"
            referencedColumns: ["id", "workspace_subject"]
          },
          {
            foreignKeyName: "market_item_subproducts_item_workspace_fkey"
            columns: ["item_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "market_items"
            referencedColumns: ["id", "workspace_subject"]
          },
        ]
      }
      market_item_view_events: {
        Row: {
          created_at: string
          id: string
          ip_hash: string | null
          item_id: string
          session_key: string | null
          user_id: string | null
          workspace_subject: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip_hash?: string | null
          item_id: string
          session_key?: string | null
          user_id?: string | null
          workspace_subject?: string
        }
        Update: {
          created_at?: string
          id?: string
          ip_hash?: string | null
          item_id?: string
          session_key?: string | null
          user_id?: string | null
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_item_view_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "market_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_item_view_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      market_items: {
        Row: {
          category_item_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          draft_source: string
          exam_month: number | null
          exam_year: number | null
          grade_level: string | null
          hwp_price: number
          id: string
          is_active: boolean
          menu_entry_id: string | null
          pdf_price: number
          published_at: string | null
          question_count: number | null
          sort_order: number
          source_1: string | null
          source_2: string | null
          source_3: string | null
          source_4: string | null
          source_type: string | null
          status: string
          subject_code: string
          summary: string | null
          thumbnail_image_id: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string
          updated_by: string | null
          view_count: number
          workspace_subject: string
          zip_price: number
        }
        Insert: {
          category_item_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          draft_source?: string
          exam_month?: number | null
          exam_year?: number | null
          grade_level?: string | null
          hwp_price?: number
          id?: string
          is_active?: boolean
          menu_entry_id?: string | null
          pdf_price?: number
          published_at?: string | null
          question_count?: number | null
          sort_order?: number
          source_1?: string | null
          source_2?: string | null
          source_3?: string | null
          source_4?: string | null
          source_type?: string | null
          status?: string
          subject_code?: string
          summary?: string | null
          thumbnail_image_id?: string | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
          view_count?: number
          workspace_subject?: string
          zip_price?: number
        }
        Update: {
          category_item_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          draft_source?: string
          exam_month?: number | null
          exam_year?: number | null
          grade_level?: string | null
          hwp_price?: number
          id?: string
          is_active?: boolean
          menu_entry_id?: string | null
          pdf_price?: number
          published_at?: string | null
          question_count?: number | null
          sort_order?: number
          source_1?: string | null
          source_2?: string | null
          source_3?: string | null
          source_4?: string | null
          source_type?: string | null
          status?: string
          subject_code?: string
          summary?: string | null
          thumbnail_image_id?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          view_count?: number
          workspace_subject?: string
          zip_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "market_items_category_item_subject_fkey"
            columns: ["category_item_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "market_category_items"
            referencedColumns: ["id", "workspace_subject"]
          },
          {
            foreignKeyName: "market_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_items_menu_entry_id_fkey"
            columns: ["menu_entry_id"]
            isOneToOne: false
            referencedRelation: "market_menu_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_items_thumbnail_image_id_fkey"
            columns: ["thumbnail_image_id"]
            isOneToOne: false
            referencedRelation: "market_images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_items_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      market_menu_entries: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          entry_key: string
          id: string
          is_active: boolean
          is_visible: boolean
          search_config: Json
          slug: string
          sort_order: number
          subject_code: string
          title: string
          updated_at: string
          workspace_subject: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          entry_key: string
          id?: string
          is_active?: boolean
          is_visible?: boolean
          search_config?: Json
          slug: string
          sort_order?: number
          subject_code?: string
          title: string
          updated_at?: string
          workspace_subject?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          entry_key?: string
          id?: string
          is_active?: boolean
          is_visible?: boolean
          search_config?: Json
          slug?: string
          sort_order?: number
          subject_code?: string
          title?: string
          updated_at?: string
          workspace_subject?: string
        }
        Relationships: []
      }
      market_purchase_lines: {
        Row: {
          bundle_option_id: string | null
          created_at: string
          id: string
          item_id: string
          line_type: string
          order_id: string
          price_credits: number
          status: string
          subproduct_id: string | null
          updated_at: string
          workspace_subject: string
        }
        Insert: {
          bundle_option_id?: string | null
          created_at?: string
          id?: string
          item_id: string
          line_type: string
          order_id: string
          price_credits?: number
          status?: string
          subproduct_id?: string | null
          updated_at?: string
          workspace_subject: string
        }
        Update: {
          bundle_option_id?: string | null
          created_at?: string
          id?: string
          item_id?: string
          line_type?: string
          order_id?: string
          price_credits?: number
          status?: string
          subproduct_id?: string | null
          updated_at?: string
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_purchase_lines_bundle_workspace_fkey"
            columns: ["bundle_option_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "market_item_bundle_options"
            referencedColumns: ["id", "workspace_subject"]
          },
          {
            foreignKeyName: "market_purchase_lines_item_workspace_fkey"
            columns: ["item_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "market_items"
            referencedColumns: ["id", "workspace_subject"]
          },
          {
            foreignKeyName: "market_purchase_lines_order_workspace_fkey"
            columns: ["order_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "market_purchase_orders"
            referencedColumns: ["id", "workspace_subject"]
          },
          {
            foreignKeyName: "market_purchase_lines_subproduct_workspace_fkey"
            columns: ["subproduct_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "market_item_subproducts"
            referencedColumns: ["id", "workspace_subject"]
          },
        ]
      }
      market_purchase_notice_acks: {
        Row: {
          consent_details: Json | null
          consent_format: number
          created_at: string
          id: string
          idempotency_key: string
          notice_sha256: string
          notice_text: string
          refund_days: number
          refund_policy_sha256: string | null
          terms_policy_sha256: string | null
          user_id: string
        }
        Insert: {
          consent_details?: Json | null
          consent_format?: number
          created_at?: string
          id?: string
          idempotency_key: string
          notice_sha256: string
          notice_text: string
          refund_days: number
          refund_policy_sha256?: string | null
          terms_policy_sha256?: string | null
          user_id: string
        }
        Update: {
          consent_details?: Json | null
          consent_format?: number
          created_at?: string
          id?: string
          idempotency_key?: string
          notice_sha256?: string
          notice_text?: string
          refund_days?: number
          refund_policy_sha256?: string | null
          terms_policy_sha256?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_purchase_notice_acks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      market_purchase_orders: {
        Row: {
          charged_credits: number
          checkout_batch_id: string | null
          created_at: string
          credit_consumptions: Json | null
          id: string
          idempotency_key: string | null
          item_id: string
          legacy_purchase_id: string | null
          original_price_credits: number
          purchase_type: string
          refund_committed_credits: number
          refunded_credits: number
          status: string
          updated_at: string
          user_id: string
          workspace_subject: string
        }
        Insert: {
          charged_credits?: number
          checkout_batch_id?: string | null
          created_at?: string
          credit_consumptions?: Json | null
          id?: string
          idempotency_key?: string | null
          item_id: string
          legacy_purchase_id?: string | null
          original_price_credits?: number
          purchase_type: string
          refund_committed_credits?: number
          refunded_credits?: number
          status?: string
          updated_at?: string
          user_id: string
          workspace_subject: string
        }
        Update: {
          charged_credits?: number
          checkout_batch_id?: string | null
          created_at?: string
          credit_consumptions?: Json | null
          id?: string
          idempotency_key?: string | null
          item_id?: string
          legacy_purchase_id?: string | null
          original_price_credits?: number
          purchase_type?: string
          refund_committed_credits?: number
          refunded_credits?: number
          status?: string
          updated_at?: string
          user_id?: string
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_purchase_orders_checkout_batch_id_fkey"
            columns: ["checkout_batch_id"]
            isOneToOne: false
            referencedRelation: "market_checkout_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_purchase_orders_item_workspace_fkey"
            columns: ["item_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "market_items"
            referencedColumns: ["id", "workspace_subject"]
          },
          {
            foreignKeyName: "market_purchase_orders_legacy_purchase_id_fkey"
            columns: ["legacy_purchase_id"]
            isOneToOne: false
            referencedRelation: "market_purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_purchase_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      market_purchases: {
        Row: {
          asset_kind: string
          created_at: string
          credit_consumptions: Json | null
          credit_resource_id: string | null
          credit_resource_type: string
          id: string
          item_id: string
          price_credits: number
          purchased_at: string
          refunded_at: string | null
          status: string
          updated_at: string
          user_id: string
          workspace_subject: string
        }
        Insert: {
          asset_kind: string
          created_at?: string
          credit_consumptions?: Json | null
          credit_resource_id?: string | null
          credit_resource_type: string
          id?: string
          item_id: string
          price_credits: number
          purchased_at?: string
          refunded_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
          workspace_subject?: string
        }
        Update: {
          asset_kind?: string
          created_at?: string
          credit_consumptions?: Json | null
          credit_resource_id?: string | null
          credit_resource_type?: string
          id?: string
          item_id?: string
          price_credits?: number
          purchased_at?: string
          refunded_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_purchases_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "market_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      market_refund_reissued_sources: {
        Row: {
          created_at: string
          original_source_id: string | null
          request_id: string
          source_id: string
        }
        Insert: {
          created_at?: string
          original_source_id?: string | null
          request_id: string
          source_id: string
        }
        Update: {
          created_at?: string
          original_source_id?: string | null
          request_id?: string
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_refund_reissued_sources_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "market_refund_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_refund_reissued_sources_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: true
            referencedRelation: "credit_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      market_refund_requests: {
        Row: {
          admin_note: string | null
          allocated_items: Json | null
          approved_refund_credits: number | null
          claim_channel: string | null
          claim_received_at: string | null
          claim_type: string | null
          created_at: string
          eligibility_snapshot: Json
          id: string
          item_id: string
          legacy_purchase_id: string | null
          order_id: string | null
          prior_request_id: string | null
          processed_at: string | null
          processed_by: string | null
          reason: string | null
          redaction_reviewed_at: string | null
          refund_kind: string
          refund_subproduct_ids: string[] | null
          reject_code: string | null
          requested_by: string | null
          requested_refund_credits: number
          status: string
          support_ticket_id: string | null
          target_kind: string
          updated_at: string
          user_id: string
          workspace_subject: string
        }
        Insert: {
          admin_note?: string | null
          allocated_items?: Json | null
          approved_refund_credits?: number | null
          claim_channel?: string | null
          claim_received_at?: string | null
          claim_type?: string | null
          created_at?: string
          eligibility_snapshot?: Json
          id?: string
          item_id: string
          legacy_purchase_id?: string | null
          order_id?: string | null
          prior_request_id?: string | null
          processed_at?: string | null
          processed_by?: string | null
          reason?: string | null
          redaction_reviewed_at?: string | null
          refund_kind?: string
          refund_subproduct_ids?: string[] | null
          reject_code?: string | null
          requested_by?: string | null
          requested_refund_credits: number
          status?: string
          support_ticket_id?: string | null
          target_kind: string
          updated_at?: string
          user_id: string
          workspace_subject: string
        }
        Update: {
          admin_note?: string | null
          allocated_items?: Json | null
          approved_refund_credits?: number | null
          claim_channel?: string | null
          claim_received_at?: string | null
          claim_type?: string | null
          created_at?: string
          eligibility_snapshot?: Json
          id?: string
          item_id?: string
          legacy_purchase_id?: string | null
          order_id?: string | null
          prior_request_id?: string | null
          processed_at?: string | null
          processed_by?: string | null
          reason?: string | null
          redaction_reviewed_at?: string | null
          refund_kind?: string
          refund_subproduct_ids?: string[] | null
          reject_code?: string | null
          requested_by?: string | null
          requested_refund_credits?: number
          status?: string
          support_ticket_id?: string | null
          target_kind?: string
          updated_at?: string
          user_id?: string
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_refund_requests_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "market_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_refund_requests_legacy_purchase_id_fkey"
            columns: ["legacy_purchase_id"]
            isOneToOne: false
            referencedRelation: "market_purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_refund_requests_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "market_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_refund_requests_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_refund_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_refund_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      market_review_tags: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string
          sort_order: number
          updated_at: string
          workspace_subject: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          updated_at?: string
          workspace_subject?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          updated_at?: string
          workspace_subject?: string
        }
        Relationships: []
      }
      market_storage_cleanup_queue: {
        Row: {
          attempt_count: number
          created_at: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          source: string
          source_item_id: string | null
          source_item_title: string | null
          storage_bucket: string
          storage_path: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          source: string
          source_item_id?: string | null
          source_item_title?: string | null
          storage_bucket: string
          storage_path: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          source?: string
          source_item_id?: string | null
          source_item_title?: string | null
          storage_bucket?: string
          storage_path?: string
        }
        Relationships: []
      }
      market_subproduct_categories: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
          workspace_subject: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
          workspace_subject: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
          workspace_subject?: string
        }
        Relationships: []
      }
      market_subproduct_files: {
        Row: {
          checksum: string | null
          content_type: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          file_size_bytes: number | null
          file_type_id: string
          id: string
          is_active: boolean
          item_id: string
          original_file_name: string
          sort_order: number
          storage_bucket: string
          storage_path: string
          subproduct_id: string
          updated_at: string
          version: number
          workspace_subject: string
        }
        Insert: {
          checksum?: string | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          file_size_bytes?: number | null
          file_type_id: string
          id?: string
          is_active?: boolean
          item_id: string
          original_file_name: string
          sort_order?: number
          storage_bucket: string
          storage_path: string
          subproduct_id: string
          updated_at?: string
          version?: number
          workspace_subject: string
        }
        Update: {
          checksum?: string | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          file_size_bytes?: number | null
          file_type_id?: string
          id?: string
          is_active?: boolean
          item_id?: string
          original_file_name?: string
          sort_order?: number
          storage_bucket?: string
          storage_path?: string
          subproduct_id?: string
          updated_at?: string
          version?: number
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_subproduct_files_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_subproduct_files_item_workspace_fkey"
            columns: ["item_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "market_items"
            referencedColumns: ["id", "workspace_subject"]
          },
          {
            foreignKeyName: "market_subproduct_files_subproduct_workspace_fkey"
            columns: ["subproduct_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "market_item_subproducts"
            referencedColumns: ["id", "workspace_subject"]
          },
          {
            foreignKeyName: "market_subproduct_files_type_workspace_fkey"
            columns: ["file_type_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "market_file_types"
            referencedColumns: ["id", "workspace_subject"]
          },
        ]
      }
      member_withdrawal_requests: {
        Row: {
          channel: string
          consent_reply_received_at: string | null
          created_at: string
          expected_balance: number
          expected_forfeit_free: number
          expected_forfeit_paid: number
          id: string
          identity_note: string | null
          marketing_withdrawn_at: string | null
          notice_sent_at: string | null
          notice_sha256: string
          notice_text: string
          received_at: string
          recorded_by: string
          requester_kind: string
          status: string
          ticket_retention_agreed: boolean | null
          user_id: string
        }
        Insert: {
          channel: string
          consent_reply_received_at?: string | null
          created_at?: string
          expected_balance: number
          expected_forfeit_free: number
          expected_forfeit_paid: number
          id?: string
          identity_note?: string | null
          marketing_withdrawn_at?: string | null
          notice_sent_at?: string | null
          notice_sha256: string
          notice_text: string
          received_at?: string
          recorded_by: string
          requester_kind?: string
          status?: string
          ticket_retention_agreed?: boolean | null
          user_id: string
        }
        Update: {
          channel?: string
          consent_reply_received_at?: string | null
          created_at?: string
          expected_balance?: number
          expected_forfeit_free?: number
          expected_forfeit_paid?: number
          id?: string
          identity_note?: string | null
          marketing_withdrawn_at?: string | null
          notice_sent_at?: string | null
          notice_sha256?: string
          notice_text?: string
          received_at?: string
          recorded_by?: string
          requester_kind?: string
          status?: string
          ticket_retention_agreed?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_withdrawal_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          broadcast_id: string | null
          created_at: string | null
          id: string
          is_read: boolean | null
          link: string | null
          message: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          broadcast_id?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          message: string
          title: string
          type: string
          user_id: string
        }
        Update: {
          broadcast_id?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          message?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      passages: {
        Row: {
          content: string
          content_translation: string | null
          created_at: string
          id: string
          is_bookmarked: boolean | null
          source_1: string | null
          source_2: string | null
          source_3: string | null
          source_4: string | null
          source_type: string | null
          subject_code: string
          tags: string[] | null
          title_en: string | null
          title_ko: string | null
          updated_at: string
          user_id: string
          workspace_subject: string
        }
        Insert: {
          content: string
          content_translation?: string | null
          created_at?: string
          id?: string
          is_bookmarked?: boolean | null
          source_1?: string | null
          source_2?: string | null
          source_3?: string | null
          source_4?: string | null
          source_type?: string | null
          subject_code?: string
          tags?: string[] | null
          title_en?: string | null
          title_ko?: string | null
          updated_at?: string
          user_id: string
          workspace_subject?: string
        }
        Update: {
          content?: string
          content_translation?: string | null
          created_at?: string
          id?: string
          is_bookmarked?: boolean | null
          source_1?: string | null
          source_2?: string | null
          source_3?: string | null
          source_4?: string | null
          source_type?: string | null
          subject_code?: string
          tags?: string[] | null
          title_en?: string | null
          title_ko?: string | null
          updated_at?: string
          user_id?: string
          workspace_subject?: string
        }
        Relationships: []
      }
      payment_admin_actions: {
        Row: {
          action: string
          actor_id: string
          after_state: Json
          before_state: Json
          created_at: string
          details: Json
          external_method: string | null
          id: string
          note: string
          payment_order_id: string | null
          recovered_credits: number | null
          refund_request_id: string | null
          unrecovered_credits: number | null
        }
        Insert: {
          action: string
          actor_id: string
          after_state?: Json
          before_state?: Json
          created_at?: string
          details?: Json
          external_method?: string | null
          id?: string
          note: string
          payment_order_id?: string | null
          recovered_credits?: number | null
          refund_request_id?: string | null
          unrecovered_credits?: number | null
        }
        Update: {
          action?: string
          actor_id?: string
          after_state?: Json
          before_state?: Json
          created_at?: string
          details?: Json
          external_method?: string | null
          id?: string
          note?: string
          payment_order_id?: string | null
          recovered_credits?: number | null
          refund_request_id?: string | null
          unrecovered_credits?: number | null
        }
        Relationships: []
      }
      payment_history: {
        Row: {
          amount: number
          approved_at: string | null
          created_at: string
          id: string
          order_id: string | null
          payment_key: string | null
          payment_method: string
          payment_order_id: string | null
          plan_id: string | null
          provider: string | null
          provider_status: string | null
          source_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          approved_at?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          payment_key?: string | null
          payment_method?: string
          payment_order_id?: string | null
          plan_id?: string | null
          provider?: string | null
          provider_status?: string | null
          source_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          payment_key?: string | null
          payment_method?: string
          payment_order_id?: string | null
          plan_id?: string | null
          provider?: string | null
          provider_status?: string | null
          source_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_history_payment_order_id_fkey"
            columns: ["payment_order_id"]
            isOneToOne: false
            referencedRelation: "payment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_history_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "pricing_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_history_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "credit_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          code: string
          created_at: string
          description: string | null
          is_enabled: boolean
          label: string
          provider: string
          provider_open_pay_type: string | null
          provider_pay_types: number[] | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          is_enabled?: boolean
          label: string
          provider: string
          provider_open_pay_type?: string | null
          provider_pay_types?: number[] | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          is_enabled?: boolean
          label?: string
          provider?: string
          provider_open_pay_type?: string | null
          provider_pay_types?: number[] | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      payment_orders: {
        Row: {
          approved_at: string | null
          cancel_idempotency_key: string
          canceled_at: string | null
          checkout_attempt_id: string | null
          checkout_expires_at: string
          confirm_expires_at: string | null
          confirm_idempotency_key: string
          created_at: string
          environment: string
          expected_amount: number
          expected_credits: number
          expires_at: string
          failure_code: string | null
          failure_message: string | null
          fulfilled_at: string | null
          id: string
          last_reconcile_error_code: string | null
          last_reconcile_error_message: string | null
          last_reconciled_at: string | null
          mid: string | null
          next_reconcile_at: string | null
          order_id: string
          partner_order_id: string | null
          partner_user_id: string | null
          payment_history_id: string | null
          payment_key: string | null
          payment_method_code: string | null
          plan_id: string | null
          plan_name_snapshot: string
          provider: string
          provider_environment: string
          provider_merchant_id: string
          provider_method: string | null
          provider_status: string | null
          ready_expires_at: string | null
          ready_requested_at: string | null
          reconcile_attempt_count: number
          request_fingerprint: string | null
          source_id: string | null
          status: string
          tax_free_amount: number
          updated_at: string
          user_id: string
          vat_amount: number | null
        }
        Insert: {
          approved_at?: string | null
          cancel_idempotency_key: string
          canceled_at?: string | null
          checkout_attempt_id?: string | null
          checkout_expires_at: string
          confirm_expires_at?: string | null
          confirm_idempotency_key: string
          created_at?: string
          environment: string
          expected_amount: number
          expected_credits: number
          expires_at: string
          failure_code?: string | null
          failure_message?: string | null
          fulfilled_at?: string | null
          id?: string
          last_reconcile_error_code?: string | null
          last_reconcile_error_message?: string | null
          last_reconciled_at?: string | null
          mid?: string | null
          next_reconcile_at?: string | null
          order_id: string
          partner_order_id?: string | null
          partner_user_id?: string | null
          payment_history_id?: string | null
          payment_key?: string | null
          payment_method_code?: string | null
          plan_id?: string | null
          plan_name_snapshot: string
          provider: string
          provider_environment: string
          provider_merchant_id: string
          provider_method?: string | null
          provider_status?: string | null
          ready_expires_at?: string | null
          ready_requested_at?: string | null
          reconcile_attempt_count?: number
          request_fingerprint?: string | null
          source_id?: string | null
          status?: string
          tax_free_amount?: number
          updated_at?: string
          user_id: string
          vat_amount?: number | null
        }
        Update: {
          approved_at?: string | null
          cancel_idempotency_key?: string
          canceled_at?: string | null
          checkout_attempt_id?: string | null
          checkout_expires_at?: string
          confirm_expires_at?: string | null
          confirm_idempotency_key?: string
          created_at?: string
          environment?: string
          expected_amount?: number
          expected_credits?: number
          expires_at?: string
          failure_code?: string | null
          failure_message?: string | null
          fulfilled_at?: string | null
          id?: string
          last_reconcile_error_code?: string | null
          last_reconcile_error_message?: string | null
          last_reconciled_at?: string | null
          mid?: string | null
          next_reconcile_at?: string | null
          order_id?: string
          partner_order_id?: string | null
          partner_user_id?: string | null
          payment_history_id?: string | null
          payment_key?: string | null
          payment_method_code?: string | null
          plan_id?: string | null
          plan_name_snapshot?: string
          provider?: string
          provider_environment?: string
          provider_merchant_id?: string
          provider_method?: string | null
          provider_status?: string | null
          ready_expires_at?: string | null
          ready_requested_at?: string | null
          reconcile_attempt_count?: number
          request_fingerprint?: string | null
          source_id?: string | null
          status?: string
          tax_free_amount?: number
          updated_at?: string
          user_id?: string
          vat_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_orders_checkout_attempt_id_fkey"
            columns: ["checkout_attempt_id"]
            isOneToOne: false
            referencedRelation: "checkout_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_orders_payment_history_id_fkey"
            columns: ["payment_history_id"]
            isOneToOne: false
            referencedRelation: "payment_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_orders_payment_method_fkey"
            columns: ["payment_method_code", "provider"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["code", "provider"]
          },
          {
            foreignKeyName: "payment_orders_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "pricing_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_orders_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "credit_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_provider_transactions: {
        Row: {
          admin_paid_confirmed_at: string | null
          callback_state_consumed_at: string | null
          callback_state_expires_at: string | null
          callback_state_hash: string | null
          cancel_feedback_recorded_at: string | null
          cancel_processed_at: string | null
          created_at: string
          fulfillment_attempt_count: number
          id: string
          last_error_code: string | null
          last_error_message: string | null
          last_reconciled_at: string | null
          next_reconcile_at: string | null
          next_redirect_app_url: string | null
          next_redirect_mobile_url: string | null
          next_redirect_pc_url: string | null
          paid_amount: number | null
          paid_feedback_recorded_at: string | null
          partial_cancel_amount: number | null
          partial_cancel_feedback_recorded_at: string | null
          partial_cancel_processed_at: string | null
          payment_method_type: string | null
          payment_order_id: string
          provider: string
          provider_approval_id: string | null
          provider_cancelled_at: string | null
          provider_merchant_id: string
          provider_paid_at: string | null
          provider_status: string | null
          provider_transaction_id: string | null
          ready_stored_at: string | null
          reconcile_attempt_count: number
          result_token_expires_at: string | null
          result_token_hash: string | null
          updated_at: string
        }
        Insert: {
          admin_paid_confirmed_at?: string | null
          callback_state_consumed_at?: string | null
          callback_state_expires_at?: string | null
          callback_state_hash?: string | null
          cancel_feedback_recorded_at?: string | null
          cancel_processed_at?: string | null
          created_at?: string
          fulfillment_attempt_count?: number
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          last_reconciled_at?: string | null
          next_reconcile_at?: string | null
          next_redirect_app_url?: string | null
          next_redirect_mobile_url?: string | null
          next_redirect_pc_url?: string | null
          paid_amount?: number | null
          paid_feedback_recorded_at?: string | null
          partial_cancel_amount?: number | null
          partial_cancel_feedback_recorded_at?: string | null
          partial_cancel_processed_at?: string | null
          payment_method_type?: string | null
          payment_order_id: string
          provider: string
          provider_approval_id?: string | null
          provider_cancelled_at?: string | null
          provider_merchant_id: string
          provider_paid_at?: string | null
          provider_status?: string | null
          provider_transaction_id?: string | null
          ready_stored_at?: string | null
          reconcile_attempt_count?: number
          result_token_expires_at?: string | null
          result_token_hash?: string | null
          updated_at?: string
        }
        Update: {
          admin_paid_confirmed_at?: string | null
          callback_state_consumed_at?: string | null
          callback_state_expires_at?: string | null
          callback_state_hash?: string | null
          cancel_feedback_recorded_at?: string | null
          cancel_processed_at?: string | null
          created_at?: string
          fulfillment_attempt_count?: number
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          last_reconciled_at?: string | null
          next_reconcile_at?: string | null
          next_redirect_app_url?: string | null
          next_redirect_mobile_url?: string | null
          next_redirect_pc_url?: string | null
          paid_amount?: number | null
          paid_feedback_recorded_at?: string | null
          partial_cancel_amount?: number | null
          partial_cancel_feedback_recorded_at?: string | null
          partial_cancel_processed_at?: string | null
          payment_method_type?: string | null
          payment_order_id?: string
          provider?: string
          provider_approval_id?: string | null
          provider_cancelled_at?: string | null
          provider_merchant_id?: string
          provider_paid_at?: string | null
          provider_status?: string | null
          provider_transaction_id?: string | null
          ready_stored_at?: string | null
          reconcile_attempt_count?: number
          result_token_expires_at?: string | null
          result_token_hash?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_provider_transactions_payment_order_id_fkey"
            columns: ["payment_order_id"]
            isOneToOne: true
            referencedRelation: "payment_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_reconciliation_alerts: {
        Row: {
          code: string
          created_at: string
          details: Json
          id: string
          message: string
          resolved_at: string | null
          severity: string
        }
        Insert: {
          code: string
          created_at?: string
          details?: Json
          id?: string
          message: string
          resolved_at?: string | null
          severity: string
        }
        Update: {
          code?: string
          created_at?: string
          details?: Json
          id?: string
          message?: string
          resolved_at?: string | null
          severity?: string
        }
        Relationships: []
      }
      payment_reconciliation_items: {
        Row: {
          error_code: string | null
          error_message: string | null
          id: string
          order_id: string
          outcome: string
          payment_order_id: string
          processed_at: string
          provider: string
          run_id: string
        }
        Insert: {
          error_code?: string | null
          error_message?: string | null
          id?: string
          order_id: string
          outcome: string
          payment_order_id: string
          processed_at?: string
          provider: string
          run_id: string
        }
        Update: {
          error_code?: string | null
          error_message?: string | null
          id?: string
          order_id?: string
          outcome?: string
          payment_order_id?: string
          processed_at?: string
          provider?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_reconciliation_items_payment_order_id_fkey"
            columns: ["payment_order_id"]
            isOneToOne: false
            referencedRelation: "payment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reconciliation_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payment_reconciliation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_reconciliation_runs: {
        Row: {
          backlog_at_start: number
          batch_limit: number
          completed_at: string | null
          created_at: string
          heartbeat_at: string
          id: string
          last_error_code: string | null
          last_error_message: string | null
          lease_expires_at: string
          manual_review_count: number
          processed_count: number
          retry_count: number
          started_at: string
          status: string
          succeeded_count: number
        }
        Insert: {
          backlog_at_start?: number
          batch_limit: number
          completed_at?: string | null
          created_at?: string
          heartbeat_at?: string
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          lease_expires_at: string
          manual_review_count?: number
          processed_count?: number
          retry_count?: number
          started_at?: string
          status: string
          succeeded_count?: number
        }
        Update: {
          backlog_at_start?: number
          batch_limit?: number
          completed_at?: string | null
          created_at?: string
          heartbeat_at?: string
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          lease_expires_at?: string
          manual_review_count?: number
          processed_count?: number
          retry_count?: number
          started_at?: string
          status?: string
          succeeded_count?: number
        }
        Relationships: []
      }
      payment_reconciliation_scheduler: {
        Row: {
          consecutive_failures: number
          id: number
          last_completed_at: string | null
          last_error_code: string | null
          last_error_message: string | null
          last_started_at: string | null
          last_succeeded_at: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          updated_at: string
        }
        Insert: {
          consecutive_failures?: number
          id?: number
          last_completed_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          last_started_at?: string | null
          last_succeeded_at?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          updated_at?: string
        }
        Update: {
          consecutive_failures?: number
          id?: number
          last_completed_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          last_started_at?: string | null
          last_succeeded_at?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      payment_runtime_config: {
        Row: {
          accepted_provider_environment: string
          change_ticket: string
          changed_at: string
          changed_by: string
          id: boolean
          kakaopay_accepts_new_orders: boolean
          kakaopay_merchant_id: string | null
          master_accepts_new_orders: boolean
          payapp_accepts_new_orders: boolean
          payapp_merchant_id: string | null
        }
        Insert: {
          accepted_provider_environment?: string
          change_ticket: string
          changed_at?: string
          changed_by: string
          id?: boolean
          kakaopay_accepts_new_orders?: boolean
          kakaopay_merchant_id?: string | null
          master_accepts_new_orders?: boolean
          payapp_accepts_new_orders?: boolean
          payapp_merchant_id?: string | null
        }
        Update: {
          accepted_provider_environment?: string
          change_ticket?: string
          changed_at?: string
          changed_by?: string
          id?: boolean
          kakaopay_accepts_new_orders?: boolean
          kakaopay_merchant_id?: string | null
          master_accepts_new_orders?: boolean
          payapp_accepts_new_orders?: boolean
          payapp_merchant_id?: string | null
        }
        Relationships: []
      }
      payment_webhook_events: {
        Row: {
          event_type: string
          id: string
          last_error_code: string | null
          order_id: string | null
          payload_hash: string
          processed_at: string | null
          processing_status: string
          provider_retry_count: number
          received_at: string
          transmission_id: string
        }
        Insert: {
          event_type: string
          id?: string
          last_error_code?: string | null
          order_id?: string | null
          payload_hash: string
          processed_at?: string | null
          processing_status?: string
          provider_retry_count?: number
          received_at?: string
          transmission_id: string
        }
        Update: {
          event_type?: string
          id?: string
          last_error_code?: string | null
          order_id?: string | null
          payload_hash?: string
          processed_at?: string | null
          processing_status?: string
          provider_retry_count?: number
          received_at?: string
          transmission_id?: string
        }
        Relationships: []
      }
      point_charge_checkout_acks: {
        Row: {
          amount: number
          checkout_attempt_id: string
          consent_details: Json | null
          consent_format: number
          created_at: string
          credits: number
          id: string
          notice_sha256: string
          notice_text: string
          plan_id: string
          plan_name: string
          refund_days: number
          refund_policy_sha256: string | null
          terms_policy_sha256: string | null
          user_id: string
        }
        Insert: {
          amount: number
          checkout_attempt_id: string
          consent_details?: Json | null
          consent_format?: number
          created_at?: string
          credits: number
          id?: string
          notice_sha256: string
          notice_text: string
          plan_id: string
          plan_name: string
          refund_days: number
          refund_policy_sha256?: string | null
          terms_policy_sha256?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          checkout_attempt_id?: string
          consent_details?: Json | null
          consent_format?: number
          created_at?: string
          credits?: number
          id?: string
          notice_sha256?: string
          notice_text?: string
          plan_id?: string
          plan_name?: string
          refund_days?: number
          refund_policy_sha256?: string | null
          terms_policy_sha256?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "point_charge_checkout_acks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_document_snapshots: {
        Row: {
          content: string
          content_sha256: string
          created_at: string
          doc_key: string
          id: string
          seq: number
          slug: string | null
          title: string | null
        }
        Insert: {
          content: string
          content_sha256: string
          created_at?: string
          doc_key: string
          id?: string
          seq?: never
          slug?: string | null
          title?: string | null
        }
        Update: {
          content?: string
          content_sha256?: string
          created_at?: string
          doc_key?: string
          id?: string
          seq?: never
          slug?: string | null
          title?: string | null
        }
        Relationships: []
      }
      pricing_plans: {
        Row: {
          badge_text: string | null
          created_at: string
          credits: number
          description: string | null
          discount_text: string | null
          id: string
          is_active: boolean
          is_highlighted: boolean
          name: string
          price: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          badge_text?: string | null
          created_at?: string
          credits: number
          description?: string | null
          discount_text?: string | null
          id?: string
          is_active?: boolean
          is_highlighted?: boolean
          name: string
          price: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          badge_text?: string | null
          created_at?: string
          credits?: number
          description?: string | null
          discount_text?: string | null
          id?: string
          is_active?: boolean
          is_highlighted?: boolean
          name?: string
          price?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      problem_type_default_prompts: {
        Row: {
          content: string
          created_at: string
          description: string | null
          display_name: string
          id: string
          is_enabled: boolean
          prompt_key: string
          sort_order: number
          updated_at: string
          workspace_subject: string
        }
        Insert: {
          content: string
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          is_enabled?: boolean
          prompt_key: string
          sort_order?: number
          updated_at?: string
          workspace_subject: string
        }
        Update: {
          content?: string
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          is_enabled?: boolean
          prompt_key?: string
          sort_order?: number
          updated_at?: string
          workspace_subject?: string
        }
        Relationships: []
      }
      problem_type_test_runs: {
        Row: {
          attempts: Json
          created_at: string
          final_question: Json | null
          final_review: Json | null
          id: string
          input: Json
          last_question: Json | null
          model_config: Json
          problem_type_id: string
          raw_generation_response: string | null
          raw_review_response: string | null
          status: string
          stop_reason: string | null
          user_id: string
          workspace_subject: string
        }
        Insert: {
          attempts?: Json
          created_at?: string
          final_question?: Json | null
          final_review?: Json | null
          id?: string
          input?: Json
          last_question?: Json | null
          model_config?: Json
          problem_type_id: string
          raw_generation_response?: string | null
          raw_review_response?: string | null
          status: string
          stop_reason?: string | null
          user_id: string
          workspace_subject?: string
        }
        Update: {
          attempts?: Json
          created_at?: string
          final_question?: Json | null
          final_review?: Json | null
          id?: string
          input?: Json
          last_question?: Json | null
          model_config?: Json
          problem_type_id?: string
          raw_generation_response?: string | null
          raw_review_response?: string | null
          status?: string
          stop_reason?: string | null
          user_id?: string
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "problem_type_test_runs_problem_type_id_fkey"
            columns: ["problem_type_id"]
            isOneToOne: false
            referencedRelation: "problem_types"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_types: {
        Row: {
          created_at: string
          description: string | null
          generation_model_name: string | null
          generation_provider: string | null
          id: string
          is_active: boolean | null
          model_name: string
          output_format: string | null
          output_format_mode: string
          prompt_template: string
          provider: string
          regeneration_prompt_template: string | null
          regeneration_prompt_template_mode: string
          review_model_name: string | null
          review_output_format: string | null
          review_output_format_mode: string
          review_prompt_template: string | null
          review_prompt_template_mode: string
          review_provider: string | null
          sort_order: number
          subject_code: string
          type_name: string
          updated_at: string
          workspace_subject: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          generation_model_name?: string | null
          generation_provider?: string | null
          id?: string
          is_active?: boolean | null
          model_name: string
          output_format?: string | null
          output_format_mode?: string
          prompt_template: string
          provider: string
          regeneration_prompt_template?: string | null
          regeneration_prompt_template_mode?: string
          review_model_name?: string | null
          review_output_format?: string | null
          review_output_format_mode?: string
          review_prompt_template?: string | null
          review_prompt_template_mode?: string
          review_provider?: string | null
          sort_order?: number
          subject_code?: string
          type_name: string
          updated_at?: string
          workspace_subject?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          generation_model_name?: string | null
          generation_provider?: string | null
          id?: string
          is_active?: boolean | null
          model_name?: string
          output_format?: string | null
          output_format_mode?: string
          prompt_template?: string
          provider?: string
          regeneration_prompt_template?: string | null
          regeneration_prompt_template_mode?: string
          review_model_name?: string | null
          review_output_format?: string | null
          review_output_format_mode?: string
          review_prompt_template?: string | null
          review_prompt_template_mode?: string
          review_provider?: string | null
          sort_order?: number
          subject_code?: string
          type_name?: string
          updated_at?: string
          workspace_subject?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string | null
          admin_role: string | null
          avatar_url: string | null
          birthdate: string | null
          created_at: string
          credits: number
          display_tag: string
          email: string | null
          gender: string | null
          id: string
          is_admin: boolean | null
          kakao_email: string | null
          kakao_id: string | null
          organization: string | null
          phone: string | null
          provider: string | null
          role: string | null
          signup_completed: boolean
          updated_at: string
          withdrawn_at: string | null
        }
        Insert: {
          address?: string | null
          admin_role?: string | null
          avatar_url?: string | null
          birthdate?: string | null
          created_at?: string
          credits?: number
          display_tag?: string
          email?: string | null
          gender?: string | null
          id: string
          is_admin?: boolean | null
          kakao_email?: string | null
          kakao_id?: string | null
          organization?: string | null
          phone?: string | null
          provider?: string | null
          role?: string | null
          signup_completed?: boolean
          updated_at?: string
          withdrawn_at?: string | null
        }
        Update: {
          address?: string | null
          admin_role?: string | null
          avatar_url?: string | null
          birthdate?: string | null
          created_at?: string
          credits?: number
          display_tag?: string
          email?: string | null
          gender?: string | null
          id?: string
          is_admin?: boolean | null
          kakao_email?: string | null
          kakao_id?: string | null
          organization?: string | null
          phone?: string | null
          provider?: string | null
          role?: string | null
          signup_completed?: boolean
          updated_at?: string
          withdrawn_at?: string | null
        }
        Relationships: []
      }
      providers: {
        Row: {
          created_at: string
          display_name: string
          display_order: number
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      question_bank_books: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
          workspace_subject: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
          workspace_subject: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
          workspace_subject?: string
        }
        Relationships: []
      }
      question_bank_problem_types: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          sort_order: number
          type_name: string
          updated_at: string
          workspace_subject: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          sort_order?: number
          type_name: string
          updated_at?: string
          workspace_subject: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          sort_order?: number
          type_name?: string
          updated_at?: string
          workspace_subject?: string
        }
        Relationships: []
      }
      question_bank_question_metadata: {
        Row: {
          bank_problem_type_id: string
          book_id: string
          created_at: string
          question_id: string
          updated_at: string
          workspace_subject: string
          year_id: string
        }
        Insert: {
          bank_problem_type_id: string
          book_id: string
          created_at?: string
          question_id: string
          updated_at?: string
          workspace_subject: string
          year_id: string
        }
        Update: {
          bank_problem_type_id?: string
          book_id?: string
          created_at?: string
          question_id?: string
          updated_at?: string
          workspace_subject?: string
          year_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_bank_metadata_bank_type_workspace_fkey"
            columns: ["bank_problem_type_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "question_bank_problem_types"
            referencedColumns: ["id", "workspace_subject"]
          },
          {
            foreignKeyName: "question_bank_question_metadata_book_workspace_fkey"
            columns: ["book_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "question_bank_books"
            referencedColumns: ["id", "workspace_subject"]
          },
          {
            foreignKeyName: "question_bank_question_metadata_question_workspace_fkey"
            columns: ["question_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id", "workspace_subject"]
          },
          {
            foreignKeyName: "question_bank_question_metadata_year_workspace_fkey"
            columns: ["year_id", "workspace_subject"]
            isOneToOne: false
            referencedRelation: "question_bank_years"
            referencedColumns: ["id", "workspace_subject"]
          },
        ]
      }
      question_bank_years: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string
          sort_order: number
          updated_at: string
          workspace_subject: string
          year: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          updated_at?: string
          workspace_subject: string
          year: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          updated_at?: string
          workspace_subject?: string
          year?: number
        }
        Relationships: []
      }
      questions: {
        Row: {
          answer: string
          choices: Json
          created_at: string
          difficulty: string | null
          explanation: string | null
          generate_generation_job_item_id: string | null
          generate_listboard_post_id: string | null
          generate_listboard_post_item_id: string | null
          grade_level: string | null
          id: string
          passage_id: string | null
          passage_text: string | null
          problem_type_id: string | null
          question_text: string
          question_text_backward: string | null
          question_text_forward: string | null
          rating: number | null
          raw_ai_response: string | null
          shared_question_id: string | null
          source: string | null
          source_1: string | null
          source_2: string | null
          source_3: string | null
          source_4: string | null
          source_type: string | null
          subject_code: string
          tags: string[] | null
          updated_at: string
          user_id: string
          workspace_subject: string
        }
        Insert: {
          answer: string
          choices: Json
          created_at?: string
          difficulty?: string | null
          explanation?: string | null
          generate_generation_job_item_id?: string | null
          generate_listboard_post_id?: string | null
          generate_listboard_post_item_id?: string | null
          grade_level?: string | null
          id?: string
          passage_id?: string | null
          passage_text?: string | null
          problem_type_id?: string | null
          question_text: string
          question_text_backward?: string | null
          question_text_forward?: string | null
          rating?: number | null
          raw_ai_response?: string | null
          shared_question_id?: string | null
          source?: string | null
          source_1?: string | null
          source_2?: string | null
          source_3?: string | null
          source_4?: string | null
          source_type?: string | null
          subject_code?: string
          tags?: string[] | null
          updated_at?: string
          user_id: string
          workspace_subject?: string
        }
        Update: {
          answer?: string
          choices?: Json
          created_at?: string
          difficulty?: string | null
          explanation?: string | null
          generate_generation_job_item_id?: string | null
          generate_listboard_post_id?: string | null
          generate_listboard_post_item_id?: string | null
          grade_level?: string | null
          id?: string
          passage_id?: string | null
          passage_text?: string | null
          problem_type_id?: string | null
          question_text?: string
          question_text_backward?: string | null
          question_text_forward?: string | null
          rating?: number | null
          raw_ai_response?: string | null
          shared_question_id?: string | null
          source?: string | null
          source_1?: string | null
          source_2?: string | null
          source_3?: string | null
          source_4?: string | null
          source_type?: string | null
          subject_code?: string
          tags?: string[] | null
          updated_at?: string
          user_id?: string
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "questions_generate_generation_job_item_id_fkey"
            columns: ["generate_generation_job_item_id"]
            isOneToOne: false
            referencedRelation: "generate_listboard_generation_job_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_generate_listboard_post_id_fkey"
            columns: ["generate_listboard_post_id"]
            isOneToOne: false
            referencedRelation: "generate_listboard_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_generate_listboard_post_item_id_fkey"
            columns: ["generate_listboard_post_item_id"]
            isOneToOne: false
            referencedRelation: "generate_listboard_post_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_passage_id_fkey"
            columns: ["passage_id"]
            isOneToOne: false
            referencedRelation: "passages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_problem_type_id_fkey"
            columns: ["problem_type_id"]
            isOneToOne: false
            referencedRelation: "problem_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_shared_question_id_fkey"
            columns: ["shared_question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_requests: {
        Row: {
          admin_note: string | null
          attempt_count: number
          cancel_idempotency_key: string | null
          created_at: string
          held_reissued_source_ids: string[]
          id: string
          last_error_code: string | null
          last_error_message: string | null
          member_reject_reason: string | null
          next_attempt_at: string | null
          origin: string
          payment_order_id: string | null
          processed_at: string | null
          processed_by: string | null
          provider: string
          provider_cancel_transaction_key: string | null
          provider_cancelled_at: string | null
          reason: string | null
          redaction_reviewed_at: string | null
          refund_amount: number | null
          source_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          attempt_count?: number
          cancel_idempotency_key?: string | null
          created_at?: string
          held_reissued_source_ids?: string[]
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          member_reject_reason?: string | null
          next_attempt_at?: string | null
          origin?: string
          payment_order_id?: string | null
          processed_at?: string | null
          processed_by?: string | null
          provider: string
          provider_cancel_transaction_key?: string | null
          provider_cancelled_at?: string | null
          reason?: string | null
          redaction_reviewed_at?: string | null
          refund_amount?: number | null
          source_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          attempt_count?: number
          cancel_idempotency_key?: string | null
          created_at?: string
          held_reissued_source_ids?: string[]
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          member_reject_reason?: string | null
          next_attempt_at?: string | null
          origin?: string
          payment_order_id?: string | null
          processed_at?: string | null
          processed_by?: string | null
          provider?: string
          provider_cancel_transaction_key?: string | null
          provider_cancelled_at?: string | null
          reason?: string | null
          redaction_reviewed_at?: string | null
          refund_amount?: number | null
          source_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_requests_payment_order_id_fkey"
            columns: ["payment_order_id"]
            isOneToOne: false
            referencedRelation: "payment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "credit_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_consent_item_versions: {
        Row: {
          content: string
          created_at: string
          item_id: string
          label: string
          note: string | null
          policy_slug: string | null
          required: boolean
          version: number
        }
        Insert: {
          content: string
          created_at?: string
          item_id: string
          label: string
          note?: string | null
          policy_slug?: string | null
          required: boolean
          version: number
        }
        Update: {
          content?: string
          created_at?: string
          item_id?: string
          label?: string
          note?: string | null
          policy_slug?: string | null
          required?: boolean
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "signup_consent_item_versions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "signup_consent_items"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_consent_items: {
        Row: {
          content: string
          created_at: string
          id: string
          is_active: boolean
          key: string
          label: string
          policy_slug: string | null
          required: boolean
          required_lock: boolean | null
          sort_order: number
          updated_at: string
          version: number
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          label: string
          policy_slug?: string | null
          required: boolean
          required_lock?: boolean | null
          sort_order?: number
          updated_at?: string
          version?: number
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          policy_slug?: string | null
          required?: boolean
          required_lock?: boolean | null
          sort_order?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "signup_consent_items_current_version_fkey"
            columns: ["id", "version"]
            isOneToOne: true
            referencedRelation: "signup_consent_item_versions"
            referencedColumns: ["item_id", "version"]
          },
        ]
      }
      source_configs: {
        Row: {
          created_at: string | null
          id: string
          source_1_label: string | null
          source_1_options: string[] | null
          source_2_label: string | null
          source_2_options: string[] | null
          source_3_label: string | null
          source_3_options: string[] | null
          source_4_label: string | null
          source_4_options: string[] | null
          type_name: string
          workspace_subject: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          source_1_label?: string | null
          source_1_options?: string[] | null
          source_2_label?: string | null
          source_2_options?: string[] | null
          source_3_label?: string | null
          source_3_options?: string[] | null
          source_4_label?: string | null
          source_4_options?: string[] | null
          type_name: string
          workspace_subject?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          source_1_label?: string | null
          source_1_options?: string[] | null
          source_2_label?: string | null
          source_2_options?: string[] | null
          source_3_label?: string | null
          source_3_options?: string[] | null
          source_4_label?: string | null
          source_4_options?: string[] | null
          type_name?: string
          workspace_subject?: string
        }
        Relationships: []
      }
      support_ticket_categories: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          guide_items: Json
          help_text: string | null
          id: string
          is_active: boolean
          message_placeholder: string | null
          name: string
          slug: string
          sort_order: number
          subject_placeholder: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          guide_items?: Json
          help_text?: string | null
          id?: string
          is_active?: boolean
          message_placeholder?: string | null
          name: string
          slug: string
          sort_order?: number
          subject_placeholder?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          guide_items?: Json
          help_text?: string | null
          id?: string
          is_active?: boolean
          message_placeholder?: string | null
          name?: string
          slug?: string
          sort_order?: number
          subject_placeholder?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ticket_categories_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_revisions: {
        Row: {
          category_id: string | null
          created_at: string
          id: string
          message: string | null
          redaction_reviewed_at: string | null
          subject: string | null
          ticket_id: string
          written_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          redaction_reviewed_at?: string | null
          subject?: string | null
          ticket_id: string
          written_at: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          redaction_reviewed_at?: string | null
          subject?: string | null
          ticket_id?: string
          written_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_revisions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          admin_response: string | null
          category_id: string | null
          category_snapshot: Json | null
          created_at: string
          id: string
          is_deleted_by_user: boolean | null
          member_updated_at: string | null
          message: string
          redaction_reviewed_at: string | null
          responded_at: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_response?: string | null
          category_id?: string | null
          category_snapshot?: Json | null
          created_at?: string
          id?: string
          is_deleted_by_user?: boolean | null
          member_updated_at?: string | null
          message: string
          redaction_reviewed_at?: string | null
          responded_at?: string | null
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_response?: string | null
          category_id?: string | null
          category_snapshot?: Json | null
          created_at?: string
          id?: string
          is_deleted_by_user?: boolean | null
          member_updated_at?: string | null
          message?: string
          redaction_reviewed_at?: string | null
          responded_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "support_ticket_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_prompts: {
        Row: {
          content: string
          created_at: string
          description: string | null
          key: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          description?: string | null
          key: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          description?: string | null
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      user_consents: {
        Row: {
          agreed: boolean
          created_at: string
          id: string
          item_id: string
          item_version: number
          policy_sha256: string | null
          seq: number
          source: string
          user_id: string
        }
        Insert: {
          agreed: boolean
          created_at?: string
          id?: string
          item_id: string
          item_version: number
          policy_sha256?: string | null
          seq?: never
          source: string
          user_id: string
        }
        Update: {
          agreed?: boolean
          created_at?: string
          id?: string
          item_id?: string
          item_version?: number
          policy_sha256?: string | null
          seq?: never
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_consents_item_version_fkey"
            columns: ["item_id", "item_version"]
            isOneToOne: false
            referencedRelation: "signup_consent_item_versions"
            referencedColumns: ["item_id", "version"]
          },
          {
            foreignKeyName: "user_consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          label: string
          sort_order: number | null
          updated_at: string | null
          value: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          label: string
          sort_order?: number | null
          updated_at?: string | null
          value: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          label?: string
          sort_order?: number | null
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      withdrawn_member_record_events: {
        Row: {
          actor_id: string | null
          created_at: string
          details: Json
          id: string
          kind: string
          ref_id: string | null
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          kind: string
          ref_id?: string | null
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          kind?: string
          ref_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawn_member_record_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "withdrawn_member_records"
            referencedColumns: ["user_id"]
          },
        ]
      }
      withdrawn_member_records: {
        Row: {
          actor_id: string
          auth_scrubbed_at: string | null
          consent_notice_sha256: string | null
          consent_notice_text: string | null
          created_at: string
          email: string | null
          forfeit_breakdown: Json
          forfeited_credits: number
          forfeited_paid_credits: number
          had_payment: boolean
          kakao_email: string | null
          kakao_id_pending_unlink: string | null
          last_market_event_at: string | null
          last_payment_event_at: string | null
          last_ticket_event_at: string | null
          marketing_withdrawn_at: string | null
          method: string
          operation_key: string
          phone: string | null
          policy_snapshot: Json
          provider_unverified_confirmed: boolean
          reason: string | null
          refund_ticket_ids: string[]
          request_id: string | null
          result: Json
          ticket_retention_agreed: boolean | null
          user_id: string
          withdrawn_at: string
        }
        Insert: {
          actor_id: string
          auth_scrubbed_at?: string | null
          consent_notice_sha256?: string | null
          consent_notice_text?: string | null
          created_at?: string
          email?: string | null
          forfeit_breakdown?: Json
          forfeited_credits?: number
          forfeited_paid_credits?: number
          had_payment: boolean
          kakao_email?: string | null
          kakao_id_pending_unlink?: string | null
          last_market_event_at?: string | null
          last_payment_event_at?: string | null
          last_ticket_event_at?: string | null
          marketing_withdrawn_at?: string | null
          method: string
          operation_key: string
          phone?: string | null
          policy_snapshot: Json
          provider_unverified_confirmed?: boolean
          reason?: string | null
          refund_ticket_ids?: string[]
          request_id?: string | null
          result: Json
          ticket_retention_agreed?: boolean | null
          user_id: string
          withdrawn_at: string
        }
        Update: {
          actor_id?: string
          auth_scrubbed_at?: string | null
          consent_notice_sha256?: string | null
          consent_notice_text?: string | null
          created_at?: string
          email?: string | null
          forfeit_breakdown?: Json
          forfeited_credits?: number
          forfeited_paid_credits?: number
          had_payment?: boolean
          kakao_email?: string | null
          kakao_id_pending_unlink?: string | null
          last_market_event_at?: string | null
          last_payment_event_at?: string | null
          last_ticket_event_at?: string | null
          marketing_withdrawn_at?: string | null
          method?: string
          operation_key?: string
          phone?: string | null
          policy_snapshot?: Json
          provider_unverified_confirmed?: boolean
          reason?: string | null
          refund_ticket_ids?: string[]
          request_id?: string | null
          result?: Json
          ticket_retention_agreed?: boolean | null
          user_id?: string
          withdrawn_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawn_member_records_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "member_withdrawal_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawn_member_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_settings: {
        Row: {
          created_at: string
          description: string | null
          id: string
          setting_key: string
          updated_at: string
          updated_by: string | null
          value: Json
          workspace_subject: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          setting_key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
          workspace_subject: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          setting_key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
          workspace_subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      admin_audit_timeline: {
        Row: {
          action: string | null
          actor_email: string | null
          actor_id: string | null
          amount: number | null
          created_at: string | null
          details: Json | null
          id: string | null
          reason: string | null
          source: string | null
          target_id: string | null
          target_type: string | null
          target_user_id: string | null
        }
        Relationships: []
      }
      workspace_subject_backfill_audit: {
        Row: {
          non_english_count: number | null
          table_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_market_cart_item: {
        Args: { p_target_id: string; p_target_kind: string; p_user_id: string }
        Returns: Json
      }
      add_withdrawn_member_event: {
        Args: {
          p_actor_id: string
          p_details: Json
          p_kind: string
          p_ref_id: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_audit_question_bank_metadata: {
        Args: { p_filter?: Json; p_workspace_subject: string }
        Returns: {
          affected_saved_copy_count: number
          duplicate_saved_copy_group_count: number
          excluded_ai_generated_count: number
          mismatched_saved_copy_metadata_count: number
          missing_admin_original_metadata_count: number
          missing_saved_copy_metadata_count: number
          unassigned_admin_original_count: number
        }[]
      }
      admin_exception_market_refund: {
        Args: {
          p_admin_id: string
          p_claim_channel: string
          p_claim_received_at: string
          p_claim_type: string
          p_confirmed_refund_credits?: number
          p_expected_committed: number
          p_expected_credits: number
          p_order_id: string
          p_reason: string
          p_subproduct_ids: string[]
          p_support_ticket_id: string
          p_ticket_revision_id: string
        }
        Returns: Json
      }
      admin_list_bank_questions: {
        Args: {
          p_book_id?: string
          p_difficulty?: string
          p_grade_level?: string
          p_limit?: number
          p_offset?: number
          p_problem_type_id?: string
          p_search?: string
          p_sort_by?: string
          p_sort_order?: string
          p_source?: string
          p_workspace_subject: string
          p_year_id?: string
        }
        Returns: {
          answer: string
          book_id: string
          book_name: string
          choices: Json
          created_at: string
          difficulty: string
          explanation: string
          grade_level: string
          id: string
          passage_text: string
          problem_type_id: string
          problem_types: Json
          profiles: Json
          question_text: string
          question_text_backward: string
          question_text_forward: string
          rating: number
          source: string
          source_1: string
          source_2: string
          source_3: string
          source_4: string
          source_type: string
          tags: string[]
          total_count: number
          updated_at: string
          user_id: string
          year_id: string
          year_label: string
        }[]
      }
      admin_list_question_bank_backfill_candidates: {
        Args: {
          p_filter?: Json
          p_limit?: number
          p_offset?: number
          p_workspace_subject: string
        }
        Returns: {
          affected_saved_copy_count: number
          current_book_id: string
          current_year_id: string
          has_saved_copy_mismatch: boolean
          missing_metadata: boolean
          problem_type_id: string
          question_id: string
          question_text: string
          total_count: number
        }[]
      }
      anonymize_member: {
        Args: {
          p_actor_id: string
          p_expected_balance: number
          p_method: string
          p_notice_text: string
          p_operation_key: string
          p_pending_tickets_confirmed?: boolean
          p_provider_unverified_confirmed: boolean
          p_reason: string
          p_request_id: string
          p_ticket_retention_agreed?: boolean
          p_user_id: string
        }
        Returns: Json
      }
      apply_payapp_feedback: {
        Args: {
          p_canceldate: string
          p_mul_no: string
          p_order_id: string
          p_orig_mul_no: string
          p_orig_price: number
          p_pay_date: string
          p_pay_state: number
          p_pay_type: number
          p_price: number
          p_userid: string
        }
        Returns: Json
      }
      approve_market_partial_refund: {
        Args: {
          p_admin_id: string
          p_admin_note: string
          p_confirmed_refund_credits?: number
          p_request_id: string
        }
        Returns: Json
      }
      approve_market_refund: {
        Args: {
          p_admin_id: string
          p_admin_note: string
          p_confirmed_refund_credits?: number
          p_request_id: string
        }
        Returns: Json
      }
      backfill_question_bank_metadata: {
        Args: {
          p_book_id: string
          p_dry_run?: boolean
          p_source_question_ids: string[]
          p_workspace_subject: string
          p_year_id: string
        }
        Returns: {
          admin_updated_count: number
          copied_updated_count: number
        }[]
      }
      begin_kakaopay_ready: {
        Args: {
          p_callback_state_expires_at: string
          p_callback_state_hash: string
          p_payment_order_id: string
        }
        Returns: Json
      }
      begin_payapp_request: {
        Args: { p_payment_order_id: string }
        Returns: Json
      }
      cancel_incomplete_kakao_signup: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      cancel_member_withdrawal_request: {
        Args: {
          p_request_id: string
          p_user_id: string
        }
        Returns: Json
      }
      checkout_market_selection: {
        Args: {
          p_idempotency_key: string
          p_item_id: string
          p_lines: Json
          p_mode: string
          p_user_id: string
        }
        Returns: Json
      }
      claim_kakaopay_callback: {
        Args: {
          p_callback_kind: string
          p_callback_state_hash: string
          p_result_token_expires_at: string
          p_result_token_hash: string
        }
        Returns: Json
      }
      claim_payment_reconciliation_batch: {
        Args: { p_limit: number; p_run_id: string }
        Returns: {
          order_id: string
        }[]
      }
      claim_point_charge_refund: {
        Args: { p_admin_id: string; p_admin_note: string; p_request_id: string }
        Returns: Json
      }
      clear_withdrawn_member_kakao_unlink: {
        Args: {
          p_outcome: string
          p_user_id: string
        }
        Returns: Json
      }
      close_withdrawn_member_held_order: {
        Args: {
          p_actor_id: string
          p_method: string
          p_note: string
          p_operation_key: string
          p_order_id: string
        }
        Returns: Json
      }
      complete_kakao_signup_with_consents: {
        Args: {
          p_email: string
          p_items: Json
          p_kakao_email: string
          p_kakao_id: string
          p_phone: string
          p_user_id: string
        }
        Returns: Json
      }
      complete_manual_point_charge_refund: {
        Args: {
          p_admin_id: string
          p_external_method: string
          p_note: string
          p_recovered_credits?: number
          p_refund_amount: number
          p_request_id: string
        }
        Returns: Json
      }
      configure_payment_reconciliation_http_cron: {
        Args: never
        Returns: number
      }
      consent_eligible_member_count: { Args: never; Returns: number }
      consent_items_error: {
        Args: { p_items: Json; p_source: string }
        Returns: string
      }
      consent_latest_results: {
        Args: { p_item_ids: string[]; p_user_id: string }
        Returns: Json
      }
      consent_missing_required: {
        Args: { p_submitted?: Json; p_user_id: string }
        Returns: string[]
      }
      consent_normalize_text: { Args: { p_value: string }; Returns: string }
      consent_record_internal: {
        Args: { p_items: Json; p_source: string; p_user_id: string }
        Returns: Json
      }
      consent_validate_submission: { Args: { p_items: Json }; Returns: string }
      consume_credits: {
        Args: {
          p_amount: number
          p_description: string
          p_resource_id: string
          p_resource_type: string
          p_user_id: string
        }
        Returns: Json
      }
      copy_admin_questions_to_user_bank: {
        Args: {
          p_admin_question_ids: string[]
          p_target_user_id: string
          p_workspace_subject: string
        }
        Returns: {
          saved_count: number
          saved_question_ids: string[]
          skipped_count: number
        }[]
      }
      create_admin_bank_question: {
        Args: {
          p_book_id: string
          p_question: Json
          p_workspace_subject: string
          p_year_id: string
        }
        Returns: string
      }
      create_admin_bank_questions_bulk: {
        Args: { p_questions: Json; p_workspace_subject: string }
        Returns: {
          failed_count: number
          inserted_count: number
          inserted_question_ids: string[]
          row_errors: Json
        }[]
      }
      create_generate_listboard_generation_job: {
        Args: {
          p_post_id: string
          p_post_item_ids: string[]
          p_problem_type_ids: string[]
          p_user_id: string
          p_workspace_subject: string
        }
        Returns: {
          job_id: string
          post_title: string
          requested_generation_count: number
          required_credits: number
          status: string
        }[]
      }
      create_member_withdrawal_request: {
        Args: {
          p_channel: string
          p_consent_reply_received_at?: string
          p_expected_balance: number
          p_expected_forfeit_free: number
          p_expected_forfeit_paid: number
          p_identity_note: string
          p_notice_sent_at?: string
          p_notice_sha256: string
          p_notice_text: string
          p_received_at?: string
          p_recorded_by: string
          p_requester_kind?: string
          p_ticket_retention_agreed?: boolean
          p_user_id: string
        }
        Returns: Json
      }
      create_random_bank_exam_paper: {
        Args: {
          p_book_id: string
          p_title: string
          p_type_counts: Json
          p_workspace_subject: string
          p_year_id: string
        }
        Returns: {
          exam_paper_id: string
          selected_question_ids: string[]
          total_count: number
        }[]
      }
      create_support_ticket: {
        Args: { p_category_id: string; p_message: string; p_subject: string }
        Returns: {
          admin_response: string | null
          category_id: string | null
          category_snapshot: Json | null
          created_at: string
          id: string
          is_deleted_by_user: boolean | null
          member_updated_at: string | null
          message: string
          responded_at: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "support_tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      credit_source_paid_root: {
        Args: { p_source_id: string }
        Returns: {
          payment_order_id: string
          root_cash_flag: boolean
          root_in_progress: boolean
          root_source_id: string
          root_status: string
        }[]
      }
      credit_source_reissued_descendants: {
        Args: { p_root_source_id: string }
        Returns: string[]
      }
      delete_market_image: { Args: { p_image_id: string }; Returns: Json }
      dispatch_admin_events: { Args: never; Returns: undefined }
      effective_default_image: {
        Args: {
          "": Database["public"]["Tables"]["market_category_items"]["Row"]
        }
        Returns: {
          bytes: number
          content_sha256: string
          created_at: string
          created_by: string | null
          display_name: string
          folder_id: string | null
          height: number
          id: string
          mime_type: string
          source_sha256: string
          storage_path: string
          width: number
        }
        SetofOptions: {
          from: "market_category_items"
          to: "market_images"
          isOneToOne: true
          isSetofReturn: true
        }
      }
      enforce_payment_reconciliation_health: { Args: never; Returns: Json }
      evaluate_market_targets: {
        Args: { p_targets: Json; p_user_id: string }
        Returns: Json
      }
      fail_payapp_request: {
        Args: {
          p_error_code: string
          p_error_message: string
          p_payment_order_id: string
        }
        Returns: Json
      }
      fail_point_charge_refund: {
        Args: {
          p_error_code: string
          p_error_message: string
          p_request_id: string
          p_retryable: boolean
        }
        Returns: undefined
      }
      finalize_kakaopay_payment: {
        Args: {
          p_approved_at: string
          p_payment_method_type: string
          p_payment_order_id: string
          p_provider_approval_id: string
          p_provider_merchant_id: string
          p_provider_status: string
          p_provider_transaction_id: string
        }
        Returns: Json
      }
      finalize_point_charge_refund: {
        Args: {
          p_provider_cancel_transaction_key: string
          p_provider_cancelled_at: string
          p_provider_status: string
          p_request_id: string
        }
        Returns: Json
      }
      finish_payment_reconciliation_run: {
        Args: {
          p_error_code: string
          p_error_message: string
          p_run_id: string
          p_success: boolean
        }
        Returns: Json
      }
      generate_member_display_tag: { Args: never; Returns: string }
      get_credit_balance_snapshot: {
        Args: { p_user_id: string }
        Returns: Json
      }
      get_manual_refund_recovery_preview: {
        Args: { p_request_id: string }
        Returns: Json
      }
      get_market_home_popular_items: {
        Args: { p_from: string; p_limit: number; p_workspace_subject: string }
        Returns: {
          download_issuer_user_count: number
          item_id: string
        }[]
      }
      get_member_withdrawal_notice: {
        Args: {
          p_kind: string
          p_ticket_retention_agreed?: boolean
          p_user_id: string
        }
        Returns: Json
      }
      get_member_withdrawal_preview: {
        Args: {
          p_ticket_retention_agreed?: boolean
          p_user_id: string
        }
        Returns: Json
      }
      get_my_missing_required_consents: { Args: never; Returns: string[] }
      get_my_payment_history: {
        Args: never
        Returns: {
          amount: number
          approved_at: string
          created_at: string
          id: string
          order_id: string
          payment_method: string
          payment_method_label: string
          plan_id: string
          plan_name: string
          provider: string
          provider_status: string
          refunded_amount: number
          status: string
        }[]
      }
      get_my_refund_requests: {
        Args: never
        Returns: {
          created_at: string
          id: string
          origin: string
          processed_at: string
          reason: string
          refund_amount: number
          source_id: string
          status: string
          updated_at: string
        }[]
      }
      get_payment_reconciliation_health: { Args: never; Returns: Json }
      get_point_charge_refund_eligibility: {
        Args: { p_source_id: string; p_user_id: string }
        Returns: Json
      }
      get_question_bank_availability: {
        Args: {
          p_book_id: string
          p_workspace_subject: string
          p_year_id: string
        }
        Returns: {
          available_count: number
          problem_type_id: string
        }[]
      }
      grant_admin_credits: {
        Args: {
          p_actor_id: string
          p_amount: number
          p_details: Json
          p_operation_key: string
          p_reason: string
          p_source_category: string
          p_user_id: string
        }
        Returns: Json
      }
      has_admin_permission: { Args: { p_permission: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_internal_admin_account: { Args: { p_email: string }; Returns: boolean }
      is_owner: { Args: never; Returns: boolean }
      mark_kakaopay_callback_failure: {
        Args: {
          p_failure_code: string
          p_failure_message: string
          p_manual_review: boolean
          p_payment_order_id: string
        }
        Returns: undefined
      }
      mark_member_text_reviewed: {
        Args: {
          p_actor_id: string
          p_target_id: string
          p_target_kind: string
        }
        Returns: Json
      }
      mark_payapp_order_terminal: {
        Args: {
          p_expected_status: string
          p_failure_code: string
          p_failure_message: string
          p_payment_order_id: string
          p_status: string
        }
        Returns: Json
      }
      mark_payment_reconciliation_terminal: {
        Args: {
          p_failure_code: string
          p_failure_message: string
          p_payment_order_id: string
          p_provider_status: string
          p_status: string
        }
        Returns: undefined
      }
      mark_withdrawn_member_auth_scrubbed: {
        Args: {
          p_user_id: string
        }
        Returns: Json
      }
      market_bundle_refund_amount: {
        Args: { p_order_id: string; p_targets: string[] }
        Returns: number
      }
      market_bundle_refund_state: {
        Args: { p_order_id: string }
        Returns: Json
      }
      market_order_upgrade_blocker: {
        Args: { p_order_id: string }
        Returns: string
      }
      market_partial_refund_calc: {
        Args: { p_base_time: string; p_order_id: string }
        Returns: Json
      }
      market_purchase_refund_days: { Args: never; Returns: number }
      market_rebuild_order_entitlements: {
        Args: { p_item_id: string; p_user_id: string }
        Returns: undefined
      }
      market_refund_allocate: {
        Args: { p_amount: number; p_exclude?: string[]; p_order_id: string }
        Returns: Json
      }
      market_refund_deadline: {
        Args: { p_created_at: string; p_days: number }
        Returns: string
      }
      market_refund_settle: {
        Args: {
          p_admin_id: string
          p_allocation: Json
          p_note: string
          p_request_id: string
        }
        Returns: Json
      }
      member_admin_event_owner: {
        Args: {
          p_ref_id: string
          p_ref_table: string
        }
        Returns: string
      }
      member_text_has_long_number: {
        Args: {
          p_text: string
        }
        Returns: boolean
      }
      member_withdrawal_facts: {
        Args: {
          p_ticket_retention_agreed?: boolean
          p_user_id: string
        }
        Returns: Json
      }
      member_withdrawal_notice_text: {
        Args: {
          p_facts: Json
          p_kind: string
          p_ticket_retention_agreed: boolean
        }
        Returns: string
      }
      member_withdrawal_policy: { Args: never; Returns: Json }
      member_withdrawal_policy_days: {
        Args: {
          p_key: string
        }
        Returns: number
      }
      member_withdrawal_require_owner: {
        Args: {
          p_actor_id: string
        }
        Returns: undefined
      }
      member_withdrawal_scrub_admin_events: {
        Args: {
          p_user_id: string
        }
        Returns: number
      }
      payapp_fulfill_order_internal: {
        Args: { p_approved_at: string; p_payment_order_id: string }
        Returns: Json
      }
      payapp_sales_resume_blockers: { Args: never; Returns: Json }
      payment_reconciliation_backlog_count: { Args: never; Returns: number }
      point_charge_cash_value: {
        Args: {
          p_credits: number
          p_source_id: string
        }
        Returns: number
      }
      point_charge_hold_reissued: {
        Args: { p_request_id: string; p_root_source_id: string }
        Returns: string[]
      }
      point_charge_refund_days: { Args: never; Returns: number }
      point_charge_refund_deadline: {
        Args: { p_base: string; p_days: number }
        Returns: string
      }
      point_charge_reissued_alert: {
        Args: {
          p_code: string
          p_extra?: Json
          p_force?: boolean
          p_order_id: string
          p_request_id: string
          p_root_source_id: string
        }
        Returns: undefined
      }
      prepare_payment_order: {
        Args: {
          p_cancel_idempotency_key: string
          p_checkout_attempt_id: string
          p_confirm_idempotency_key: string
          p_expected_amount: number
          p_expected_credits: number
          p_expires_at: string
          p_order_id: string
          p_partner_user_id: string
          p_payment_method_code?: string
          p_plan_id: string
          p_plan_name_snapshot: string
          p_provider: string
          p_provider_environment: string
          p_provider_merchant_id: string
          p_request_fingerprint: string
          p_tax_free_amount: number
          p_user_id: string
          p_vat_amount: number
        }
        Returns: {
          approved_at: string | null
          cancel_idempotency_key: string
          canceled_at: string | null
          checkout_attempt_id: string | null
          checkout_expires_at: string
          confirm_expires_at: string | null
          confirm_idempotency_key: string
          created_at: string
          environment: string
          expected_amount: number
          expected_credits: number
          expires_at: string
          failure_code: string | null
          failure_message: string | null
          fulfilled_at: string | null
          id: string
          last_reconcile_error_code: string | null
          last_reconcile_error_message: string | null
          last_reconciled_at: string | null
          mid: string | null
          next_reconcile_at: string | null
          order_id: string
          partner_order_id: string | null
          partner_user_id: string | null
          payment_history_id: string | null
          payment_key: string | null
          payment_method_code: string | null
          plan_id: string | null
          plan_name_snapshot: string
          provider: string
          provider_environment: string
          provider_merchant_id: string
          provider_method: string | null
          provider_status: string | null
          ready_expires_at: string | null
          ready_requested_at: string | null
          reconcile_attempt_count: number
          request_fingerprint: string | null
          source_id: string | null
          status: string
          tax_free_amount: number
          updated_at: string
          user_id: string
          vat_amount: number | null
        }
        SetofOptions: {
          from: "*"
          to: "payment_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      preview_market_partial_refund: {
        Args: { p_order_id: string; p_user_id: string }
        Returns: Json
      }
      process_payapp_cancellation: {
        Args: { p_payment_order_id: string }
        Returns: Json
      }
      prune_expired_ai_question_generation_runs: {
        Args: never
        Returns: number
      }
      quarantine_external_provider_cancellation: {
        Args: {
          p_payment_order_id: string
          p_provider_cancel_transaction_key: string
          p_provider_cancelled_at: string
          p_provider_status: string
        }
        Returns: Json
      }
      quarantine_kakaopay_partial_cancellation: {
        Args: {
          p_cancelled_amount: number
          p_payment_order_id: string
          p_provider_status: string
        }
        Returns: Json
      }
      quarantine_payapp_partial_cancellation: {
        Args: { p_payment_order_id: string }
        Returns: Json
      }
      read_withdrawn_member_record: {
        Args: {
          p_actor_id: string
          p_reason: string
          p_request_meta?: Json
          p_user_id: string
        }
        Returns: Json
      }
      read_withdrawn_member_ticket: {
        Args: {
          p_actor_id: string
          p_reason: string
          p_request_meta?: Json
          p_ticket_id: string
        }
        Returns: Json
      }
      record_admin_audit: {
        Args: {
          p_action: string
          p_actor_id: string
          p_amount: number
          p_details: Json
          p_reason: string
          p_request_id: string
          p_target_id: string
          p_target_type: string
          p_target_user_id: string
        }
        Returns: string
      }
      record_kakaopay_approval: {
        Args: {
          p_approved_at: string
          p_payment_method_type: string
          p_payment_order_id: string
          p_provider_approval_id: string
          p_provider_status: string
          p_provider_transaction_id: string
        }
        Returns: Json
      }
      record_kakaopay_partial_cancel_marker: {
        Args: { p_payment_order_id: string; p_provider_status: string }
        Returns: Json
      }
      record_member_withdrawal_request_reply: {
        Args: {
          p_actor_id: string
          p_consent_reply_received_at: string
          p_notice_sent_at: string
          p_request_id: string
          p_ticket_retention_agreed: boolean
        }
        Returns: Json
      }
      record_payment_alert: {
        Args: {
          p_code: string
          p_details: Json
          p_message: string
          p_severity: string
        }
        Returns: boolean
      }
      record_payment_reconciliation_result: {
        Args: {
          p_error_code: string
          p_error_message: string
          p_order_id: string
          p_outcome: string
          p_run_id: string
        }
        Returns: boolean
      }
      record_point_charge_checkout_ack: {
        Args: {
          p_checkout_attempt_id: string
          p_expected_amount: number
          p_expected_credits: number
          p_notice_sha256: string
          p_plan_id: string
          p_user_id: string
        }
        Returns: Json
      }
      record_purchase_notice_ack: {
        Args: {
          p_cart_texts_sha256?: string
          p_idempotency_key: string
          p_notice_sha256: string
          p_user_id: string
        }
        Returns: Json
      }
      record_user_consents: {
        Args: { p_items: Json; p_source: string; p_user_id: string }
        Returns: Json
      }
      redact_member_text: {
        Args: {
          p_actor_id: string
          p_field: string
          p_operation_key: string
          p_target_id: string
          p_target_kind: string
          p_target_text: string
        }
        Returns: Json
      }
      refund_credits: {
        Args: {
          p_amount: number
          p_consumptions: Json
          p_description: string
          p_resource_id: string
          p_resource_type: string
          p_target_balance?: number
          p_user_id: string
        }
        Returns: Json
      }
      reject_point_charge_refund: {
        Args: {
          p_admin_id: string
          p_admin_note: string
          p_member_reason: string
          p_provider_not_cancelled_confirmed: boolean
          p_request_id: string
        }
        Returns: Json
      }
      remind_unanswered_admin_work: { Args: never; Returns: undefined }
      remove_market_cart_items: {
        Args: { p_ids: string[]; p_user_id: string }
        Returns: Json
      }
      replace_admin_permission_grants: {
        Args: { p_actor_id: string; p_grants: Json; p_user_id: string }
        Returns: Json
      }
      replace_generate_listboard_post_items: {
        Args: {
          p_admin_user_id: string
          p_items: Json
          p_post_id: string
          p_workspace_subject: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          is_active: boolean
          passage_text: string
          post_id: string
          question_number: string
          sort_order: number
          updated_at: string
          updated_by: string | null
          workspace_subject: string
        }[]
        SetofOptions: {
          from: "*"
          to: "generate_listboard_post_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      request_market_partial_refund: {
        Args: {
          p_expected_credits: number
          p_order_id: string
          p_prior_request_id?: string
          p_reason: string
          p_user_id: string
        }
        Returns: Json
      }
      request_point_charge_refund: {
        Args: { p_reason: string; p_source_id: string; p_user_id: string }
        Returns: Json
      }
      requeue_stuck_point_charge_refund: {
        Args: { p_request_id: string }
        Returns: Json
      }
      resolve_member_full_delete_auth_alert: {
        Args: {
          p_user_id: string
        }
        Returns: Json
      }
      resolve_payment_alert: {
        Args: { p_actor_id: string; p_alert_id: string; p_note: string }
        Returns: Json
      }
      resolve_payment_order_review: {
        Args: {
          p_action: string
          p_actor_id: string
          p_external_method?: string
          p_mul_no?: string
          p_note: string
          p_paid_at?: string
          p_payment_order_id: string
        }
        Returns: Json
      }
      resume_payment_sales: {
        Args: { p_changed_by: string; p_reason: string; p_scope: string }
        Returns: Json
      }
      retry_payapp_fulfillment: {
        Args: { p_payment_order_id: string }
        Returns: Json
      }
      revise_signup_consent_item: {
        Args: {
          p_actor_id: string
          p_dry_run?: boolean
          p_expected_version: number
          p_id: string
          p_note: string
        }
        Returns: Json
      }
      revoke_admin_account: {
        Args: { p_actor_id: string; p_user_id: string }
        Returns: Json
      }
      revoke_admin_credits: {
        Args: {
          p_actor_id: string
          p_amount: number
          p_operation_key: string
          p_reason: string
          p_source_id: string
        }
        Returns: Json
      }
      save_signup_consent_item: {
        Args: {
          p_actor_id: string
          p_content: string
          p_dry_run?: boolean
          p_expected_updated_at: string
          p_expected_version: number
          p_id: string
          p_is_active: boolean
          p_label: string
          p_note: string
          p_policy_slug: string
          p_required: boolean
          p_sort_order: number
        }
        Returns: Json
      }
      scrub_member_admin_events: {
        Args: {
          p_user_id: string
        }
        Returns: Json
      }
      set_admin_credit_grant_limits: {
        Args: { p_actor_id: string; p_per_day: number; p_per_grant: number }
        Returns: Json
      }
      set_market_cart_selection: {
        Args: { p_ids: string[]; p_selected: boolean; p_user_id: string }
        Returns: Json
      }
      settle_market_refund_by_owner: {
        Args: {
          p_confirmed_refund_credits?: number
          p_items: Json
          p_note: string
          p_owner_id: string
          p_request_id: string
        }
        Returns: Json
      }
      signup_consent_item_stats: {
        Args: never
        Returns: {
          agreed_members: number
          item_id: string
          version: number
        }[]
      }
      soft_delete_own_support_ticket: {
        Args: { p_ticket_id: string }
        Returns: {
          admin_response: string | null
          category_id: string | null
          category_snapshot: Json | null
          created_at: string
          id: string
          is_deleted_by_user: boolean | null
          member_updated_at: string | null
          message: string
          responded_at: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "support_tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_payment_reconciliation_run: {
        Args: { p_limit: number }
        Returns: Json
      }
      stop_payment_sales: {
        Args: { p_changed_by: string; p_reason: string; p_scope: string }
        Returns: Json
      }
      store_kakaopay_ready: {
        Args: {
          p_next_redirect_app_url: string
          p_next_redirect_mobile_url: string
          p_next_redirect_pc_url: string
          p_payment_order_id: string
          p_provider_transaction_id: string
          p_ready_stored_at: string
        }
        Returns: Json
      }
      store_payapp_request: {
        Args: { p_mul_no: string; p_payment_order_id: string; p_payurl: string }
        Returns: Json
      }
      update_admin_bank_question: {
        Args: {
          p_book_id: string
          p_question_id: string
          p_question_patch: Json
          p_workspace_subject: string
          p_year_id: string
        }
        Returns: {
          copied_updated_count: number
          question_id: string
        }[]
      }
      update_main_ad_carousel_subject: {
        Args: { p_subject: string; p_subject_config: Json }
        Returns: {
          after_config: Json
          before_config: Json
        }[]
      }
      update_own_pending_support_ticket: {
        Args: {
          p_category_id: string
          p_message: string
          p_subject: string
          p_ticket_id: string
        }
        Returns: {
          admin_response: string | null
          category_id: string | null
          category_snapshot: Json | null
          created_at: string
          id: string
          is_deleted_by_user: boolean | null
          member_updated_at: string | null
          message: string
          responded_at: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "support_tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      withdrawn_member_account_status: {
        Args: {
          p_user_id: string
        }
        Returns: Json
      }
      withdrawn_member_held_order_ids: {
        Args: {
          p_order_ids: string[]
        }
        Returns: string[]
      }
      withdrawn_member_kakao_unlink_target: {
        Args: {
          p_user_id: string
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
