export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
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
          }
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
          }
        ]
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
          grade_level: string | null
          id: string
          passage_text: string | null
          problem_type_id: string | null
          question_text: string
          raw_ai_response: string | null
          shared_question_id: string | null
          source: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          answer: string
          choices: Json
          created_at?: string
          difficulty?: string | null
          explanation?: string | null
          grade_level?: string | null
          id?: string
          passage_text?: string | null
          problem_type_id?: string | null
          question_text: string
          raw_ai_response?: string | null
          shared_question_id?: string | null
          source?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          answer?: string
          choices?: Json
          created_at?: string
          difficulty?: string | null
          explanation?: string | null
          grade_level?: string | null
          id?: string
          passage_text?: string | null
          problem_type_id?: string | null
          question_text?: string
          raw_ai_response?: string | null
          shared_question_id?: string | null
          source?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
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
          }
        ]
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

