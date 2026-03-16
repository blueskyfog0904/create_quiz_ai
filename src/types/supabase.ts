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
      credit_transactions: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          id: string
          resource_id: string | null
          resource_type: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          resource_id?: string | null
          resource_type?: string | null
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          resource_id?: string | null
          resource_type?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
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
        }
        Insert: {
          created_at?: string
          exam_paper_id: string
          id?: string
          number: number
          order_index: number
          question_id: string
        }
        Update: {
          created_at?: string
          exam_paper_id?: string
          id?: string
          number?: number
          order_index?: number
          question_id?: string
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
          id: string
          paper_title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          paper_title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          paper_title?: string
          updated_at?: string
          user_id?: string
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
      generate_listboard_generation_job_items: {
        Row: {
          attempt_count: number
          created_at: string
          credit_charged: number
          error_code: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          job_id: string
          post_id: string
          post_item_id: string
          problem_type_id: string
          question_id: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          credit_charged?: number
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_id: string
          post_id: string
          post_item_id: string
          problem_type_id: string
          question_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          credit_charged?: number
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_id?: string
          post_id?: string
          post_item_id?: string
          problem_type_id?: string
          question_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
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
          failed_count: number
          finished_at: string | null
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
        }
        Insert: {
          cancelled_count?: number
          completed_count?: number
          created_at?: string
          credit_charged?: number
          credit_reserved?: number
          failed_count?: number
          finished_at?: string | null
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
        }
        Update: {
          cancelled_count?: number
          completed_count?: number
          created_at?: string
          credit_charged?: number
          credit_reserved?: number
          failed_count?: number
          finished_at?: string | null
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
      notifications: {
        Row: {
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
        Relationships: []
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
            foreignKeyName: "payment_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
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
          id: string
          is_active: boolean | null
          model_name: string
          output_format: string | null
          prompt_template: string
          provider: string
          type_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          model_name: string
          output_format?: string | null
          prompt_template: string
          provider: string
          type_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          model_name?: string
          output_format?: string | null
          prompt_template?: string
          provider?: string
          type_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string | null
          avatar_url: string | null
          birthdate: string | null
          created_at: string
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
      support_tickets: {
        Row: {
          admin_response: string | null
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
      user_roles: {
        Row: {
          id: string
          value: string
          label: string
          sort_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          value: string
          label: string
          sort_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          value?: string
          label?: string
          sort_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_credits: {
        Row: {
          balance: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      is_admin: { Args: never; Returns: boolean }
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
