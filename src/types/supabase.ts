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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
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
          expires_at: string | null
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
          expires_at?: string | null
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
          expires_at?: string | null
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
          {
            foreignKeyName: "ai_question_generation_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
          resource_id: string | null
          resource_type: string | null
          source_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          resource_id?: string | null
          resource_type?: string | null
          source_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          resource_id?: string | null
          resource_type?: string | null
          source_id?: string
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
        }
        Insert: {
          category: string
          created_at?: string | null
          db_value: string
          display_value: string
          id?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          db_value?: string
          display_value?: string
          id?: string
          sort_order?: number | null
          updated_at?: string | null
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
      generate_listboard_generation_job_items: {
        Row: {
          attempt_count: number
          created_at: string
          credit_charged: number
          error_code: string | null
          error_message: string | null
          finished_at: string | null
          generated_question: Json | null
          id: string
          job_id: string
          post_id: string
          post_item_id: string
          problem_type_id: string
          question_id: string | null
          raw_ai_response: string | null
          save_error_message: string | null
          save_status: string
          saved_at: string | null
          started_at: string | null
          status: string
          updated_at: string
          workspace_subject: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          credit_charged?: number
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          generated_question?: Json | null
          id?: string
          job_id: string
          post_id: string
          post_item_id: string
          problem_type_id: string
          question_id?: string | null
          raw_ai_response?: string | null
          save_error_message?: string | null
          save_status?: string
          saved_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          workspace_subject?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          credit_charged?: number
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          generated_question?: Json | null
          id?: string
          job_id?: string
          post_id?: string
          post_item_id?: string
          problem_type_id?: string
          question_id?: string | null
          raw_ai_response?: string | null
          save_error_message?: string | null
          save_status?: string
          saved_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          workspace_subject?: string
        }
        Relationships: [
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
          post_id: string
          requested_generation_count: number
          requested_item_count: number
          requested_type_count: number
          selected_problem_type_ids: string[]
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
          post_id: string
          requested_generation_count?: number
          requested_item_count?: number
          requested_type_count?: number
          selected_problem_type_ids?: string[]
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
          post_id?: string
          requested_generation_count?: number
          requested_item_count?: number
          requested_type_count?: number
          selected_problem_type_ids?: string[]
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
          committed_at: string | null
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
        }
        Insert: {
          committed_at?: string | null
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
          title: string
          updated_at: string
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
          title: string
          updated_at?: string
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
          title?: string
          updated_at?: string
        }
        Relationships: []
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
          sort_order?: number
          updated_at?: string
          workspace_subject?: string
        }
        Relationships: []
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
          sort_order?: number
          title?: string
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
        Relationships: []
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
        Relationships: []
      }
      market_purchase_orders: {
        Row: {
          charged_credits: number
          credit_consumptions: Json | null
          created_at: string
          id: string
          idempotency_key: string | null
          item_id: string
          legacy_purchase_id: string | null
          original_price_credits: number
          purchase_type: string
          status: string
          updated_at: string
          user_id: string
          workspace_subject: string
        }
        Insert: {
          charged_credits?: number
          credit_consumptions?: Json | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          item_id: string
          legacy_purchase_id?: string | null
          original_price_credits?: number
          purchase_type: string
          status?: string
          updated_at?: string
          user_id: string
          workspace_subject: string
        }
        Update: {
          charged_credits?: number
          credit_consumptions?: Json | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          item_id?: string
          legacy_purchase_id?: string | null
          original_price_credits?: number
          purchase_type?: string
          status?: string
          updated_at?: string
          user_id?: string
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
        Relationships: []
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
        Relationships: []
      }
      market_refund_requests: {
        Row: {
          admin_note: string | null
          approved_refund_credits: number | null
          created_at: string
          eligibility_snapshot: Json
          id: string
          item_id: string
          legacy_purchase_id: string | null
          order_id: string | null
          processed_at: string | null
          processed_by: string | null
          reason: string | null
          requested_refund_credits: number
          status: string
          target_kind: string
          updated_at: string
          user_id: string
          workspace_subject: string
        }
        Insert: {
          admin_note?: string | null
          approved_refund_credits?: number | null
          created_at?: string
          eligibility_snapshot?: Json
          id?: string
          item_id: string
          legacy_purchase_id?: string | null
          order_id?: string | null
          processed_at?: string | null
          processed_by?: string | null
          reason?: string | null
          requested_refund_credits: number
          status?: string
          target_kind: string
          updated_at?: string
          user_id: string
          workspace_subject: string
        }
        Update: {
          admin_note?: string | null
          approved_refund_credits?: number | null
          created_at?: string
          eligibility_snapshot?: Json
          id?: string
          item_id?: string
          legacy_purchase_id?: string | null
          order_id?: string | null
          processed_at?: string | null
          processed_by?: string | null
          reason?: string | null
          requested_refund_credits?: number
          status?: string
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
            foreignKeyName: "market_refund_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
            foreignKeyName: "market_item_sample_pages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
      market_item_view_events: {
        Row: {
          created_at: string
          id: string
          ip_hash: string | null
          item_id: string
          session_key: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip_hash?: string | null
          item_id: string
          session_key?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip_hash?: string | null
          item_id?: string
          session_key?: string | null
          user_id?: string | null
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
          menu_entry_id: string
          pdf_price: number
          zip_price: number
          published_at: string | null
          question_count: number | null
          sort_order: number
          source_1: string | null
          source_2: string | null
          source_3: string | null
          source_4: string | null
          source_type: string | null
          status: string
          summary: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string
          updated_by: string | null
          view_count: number
        }
        Insert: {
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
          menu_entry_id: string
          pdf_price?: number
          zip_price?: number
          published_at?: string | null
          question_count?: number | null
          sort_order?: number
          source_1?: string | null
          source_2?: string | null
          source_3?: string | null
          source_4?: string | null
          source_type?: string | null
          status?: string
          summary?: string | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
          view_count?: number
        }
        Update: {
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
          menu_entry_id?: string
          pdf_price?: number
          zip_price?: number
          published_at?: string | null
          question_count?: number | null
          sort_order?: number
          source_1?: string | null
          source_2?: string | null
          source_3?: string | null
          source_4?: string | null
          source_type?: string | null
          status?: string
          summary?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          view_count?: number
        }
        Relationships: [
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
          title: string
          updated_at: string
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
          title: string
          updated_at?: string
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
          title?: string
          updated_at?: string
        }
        Relationships: []
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
      notifications: {
        Row: {
          action_url: string | null
          created_at: string
          id: string
          is_read: boolean | null
          message: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action_url?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          message: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action_url?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          message?: string
          type?: string
          updated_at?: string
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
          tags: string[] | null
          title_en: string | null
          title_ko: string | null
          updated_at: string
          user_id: string
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
          tags?: string[] | null
          title_en?: string | null
          title_ko?: string | null
          updated_at?: string
          user_id: string
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
          tags?: string[] | null
          title_en?: string | null
          title_ko?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "passages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_history: {
        Row: {
          amount: number
          created_at: string
          id: string
          payment_key: string | null
          payment_method: string
          plan_id: string | null
          source_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          payment_key?: string | null
          payment_method?: string
          plan_id?: string | null
          source_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          payment_key?: string | null
          payment_method?: string
          plan_id?: string | null
          source_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
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
      pricing_plans: {
        Row: {
          created_at: string
          credits: number
          description: string | null
          id: string
          is_active: boolean
          name: string
          price: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          credits: number
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          price: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          credits?: number
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
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
          prompt_template: string
          provider: string
          regeneration_prompt_template: string | null
          review_model_name: string | null
          review_output_format: string | null
          review_provider: string | null
          review_prompt_template: string | null
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
          prompt_template: string
          provider: string
          regeneration_prompt_template?: string | null
          review_model_name?: string | null
          review_output_format?: string | null
          review_provider?: string | null
          review_prompt_template?: string | null
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
          prompt_template?: string
          provider?: string
          regeneration_prompt_template?: string | null
          review_model_name?: string | null
          review_output_format?: string | null
          review_provider?: string | null
          review_prompt_template?: string | null
          type_name?: string
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
          {
            foreignKeyName: "problem_type_test_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address: string | null
          avatar_url: string | null
          birthdate: string | null
          created_at: string
          credits: number
          email: string | null
          gender: string | null
          id: string
          is_admin: boolean | null
          kakao_email: string | null
          kakao_id: string | null
          name: string | null
          organization: string | null
          phone: string | null
          provider: string | null
          role: string | null
          signup_completed: boolean
          updated_at: string
        }
        Insert: {
          address?: string | null
          avatar_url?: string | null
          birthdate?: string | null
          created_at?: string
          credits?: number
          email?: string | null
          gender?: string | null
          id: string
          is_admin?: boolean | null
          kakao_email?: string | null
          kakao_id?: string | null
          name?: string | null
          organization?: string | null
          phone?: string | null
          provider?: string | null
          role?: string | null
          signup_completed?: boolean
          updated_at?: string
        }
        Update: {
          address?: string | null
          avatar_url?: string | null
          birthdate?: string | null
          created_at?: string
          credits?: number
          email?: string | null
          gender?: string | null
          id?: string
          is_admin?: boolean | null
          kakao_email?: string | null
          kakao_id?: string | null
          name?: string | null
          organization?: string | null
          phone?: string | null
          provider?: string | null
          role?: string | null
          signup_completed?: boolean
          updated_at?: string
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
            isOneToOne: true
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
          created_at: string
          id: string
          processed_at: string | null
          processed_by: string | null
          reason: string | null
          source_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          id?: string
          processed_at?: string | null
          processed_by?: string | null
          reason?: string | null
          source_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          id?: string
          processed_at?: string | null
          processed_by?: string | null
          reason?: string | null
          source_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
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
      support_tickets: {
        Row: {
          admin_response: string | null
          category_id: string | null
          category_snapshot: Json | null
          created_at: string
          id: string
          is_deleted_by_user: boolean | null
          message: string
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
          message: string
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
          message?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_support_ticket: {
        Args: {
          p_category_id: string
          p_message: string
          p_subject: string
        }
        Returns: Database["public"]["Tables"]["support_tickets"]["Row"]
      }
      soft_delete_own_support_ticket: {
        Args: { p_ticket_id: string }
        Returns: Database["public"]["Tables"]["support_tickets"]["Row"]
      }
      update_own_pending_support_ticket: {
        Args: {
          p_category_id: string
          p_message: string
          p_subject: string
          p_ticket_id: string
        }
        Returns: Database["public"]["Tables"]["support_tickets"]["Row"]
      }
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
      deduct_credits: {
        Args: {
          p_amount: number
          p_description: string
          p_resource_id?: string
          p_resource_type?: string
          p_user_id: string
        }
        Returns: number
      }
      grant_credits: {
        Args: {
          p_amount: number
          p_description: string
          p_resource_id?: string
          p_resource_type?: string
          p_type?: string
          p_user_id: string
        }
        Returns: number
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
      admin_list_bank_questions: {
        Args: {
          p_book_id?: string | null
          p_difficulty?: string | null
          p_grade_level?: string | null
          p_limit?: number
          p_offset?: number
          p_problem_type_id?: string | null
          p_search?: string | null
          p_sort_by?: string
          p_sort_order?: string
          p_source?: string | null
          p_workspace_subject: string
          p_year_id?: string | null
        }
        Returns: {
          answer: string
          book_id: string | null
          book_name: string | null
          choices: Json
          created_at: string
          difficulty: string | null
          explanation: string | null
          grade_level: string | null
          id: string
          passage_text: string | null
          problem_type_id: string | null
          problem_types: Json | null
          profiles: Json
          question_text: string
          question_text_backward: string | null
          question_text_forward: string | null
          rating: number | null
          source: string | null
          source_1: string | null
          source_2: string | null
          source_3: string | null
          source_4: string | null
          source_type: string | null
          tags: string[] | null
          total_count: number
          updated_at: string
          user_id: string
          year_id: string | null
          year_label: string | null
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
          current_book_id: string | null
          current_year_id: string | null
          has_saved_copy_mismatch: boolean
          missing_metadata: boolean
          problem_type_id: string | null
          question_id: string
          question_text: string
          total_count: number
        }[]
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
      is_admin: { Args: never; Returns: boolean }
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
