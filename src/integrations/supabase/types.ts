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
      activity_logs: {
        Row: {
          action_type: string
          advertiser_id: string | null
          advertiser_name: string | null
          advertiser_public_id: string | null
          created_at: string
          finished_at: string | null
          id: string
          reward_pt: number
          started_at: string | null
          task_id: string | null
          task_public_id: string | null
          task_title: string | null
          user_id: string | null
          user_telegram_id: number | null
          user_username: string | null
          video_ad_id: string | null
        }
        Insert: {
          action_type: string
          advertiser_id?: string | null
          advertiser_name?: string | null
          advertiser_public_id?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          reward_pt?: number
          started_at?: string | null
          task_id?: string | null
          task_public_id?: string | null
          task_title?: string | null
          user_id?: string | null
          user_telegram_id?: number | null
          user_username?: string | null
          video_ad_id?: string | null
        }
        Update: {
          action_type?: string
          advertiser_id?: string | null
          advertiser_name?: string | null
          advertiser_public_id?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          reward_pt?: number
          started_at?: string | null
          task_id?: string | null
          task_public_id?: string | null
          task_title?: string | null
          user_id?: string | null
          user_telegram_id?: number | null
          user_username?: string | null
          video_ad_id?: string | null
        }
        Relationships: []
      }
      admin_alerts: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      advertisers: {
        Row: {
          created_at: string
          id: string
          name: string
          public_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          public_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          public_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      logs_activity: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_address: unknown
          metadata: Json | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "logs_activity_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          is_paused: boolean
          max_uses: number | null
          reward_pt: number
          updated_at: string
          used_count: number
        }
        Insert: {
          code: string
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          is_paused?: boolean
          max_uses?: number | null
          reward_pt: number
          updated_at?: string
          used_count?: number
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          is_paused?: boolean
          max_uses?: number | null
          reward_pt?: number
          updated_at?: string
          used_count?: number
        }
        Relationships: []
      }
      promo_redemptions: {
        Row: {
          id: string
          promo_id: string
          redeemed_at: string
          reward_pt: number
          user_id: string
        }
        Insert: {
          id?: string
          promo_id: string
          redeemed_at?: string
          reward_pt: number
          user_id: string
        }
        Update: {
          id?: string
          promo_id?: string
          redeemed_at?: string
          reward_pt?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_redemptions_promo_id_fkey"
            columns: ["promo_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      public_ids_registry: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string
          prefix: string
          public_id: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type: string
          prefix: string
          public_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          prefix?: string
          public_id?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      subscription_checks: {
        Row: {
          attempts: number
          channel_id: string | null
          channel_username: string | null
          check_at: string
          created_at: string
          id: string
          last_error: string | null
          processed_at: string | null
          reward_pt: number
          status: string
          task_id: string
          telegram_id: number
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          channel_id?: string | null
          channel_username?: string | null
          check_at: string
          created_at?: string
          id?: string
          last_error?: string | null
          processed_at?: string | null
          reward_pt?: number
          status?: string
          task_id: string
          telegram_id: number
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          channel_id?: string | null
          channel_username?: string | null
          check_at?: string
          created_at?: string
          id?: string
          last_error?: string | null
          processed_at?: string | null
          reward_pt?: number
          status?: string
          task_id?: string
          telegram_id?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      task_completions: {
        Row: {
          completed_at: string
          id: string
          task_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string
          id?: string
          task_id: string
          user_id: string
        }
        Update: {
          completed_at?: string
          id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_completions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_completions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          advertiser_id: string | null
          channel_id: number | null
          channel_username: string | null
          created_at: string
          current_completions: number | null
          hold_days: number | null
          id: string
          is_active: boolean
          is_extra: boolean
          max_completions: number | null
          min_seconds_away: number
          post_url: string | null
          public_id: string | null
          reaction_emoji: string | null
          reward_pt: number
          sub_recheck_minutes: number
          title: string | null
          type: Database["public"]["Enums"]["task_type"]
        }
        Insert: {
          advertiser_id?: string | null
          channel_id?: number | null
          channel_username?: string | null
          created_at?: string
          current_completions?: number | null
          hold_days?: number | null
          id?: string
          is_active?: boolean
          is_extra?: boolean
          max_completions?: number | null
          min_seconds_away?: number
          post_url?: string | null
          public_id?: string | null
          reaction_emoji?: string | null
          reward_pt?: number
          sub_recheck_minutes?: number
          title?: string | null
          type: Database["public"]["Enums"]["task_type"]
        }
        Update: {
          advertiser_id?: string | null
          channel_id?: number | null
          channel_username?: string | null
          created_at?: string
          current_completions?: number | null
          hold_days?: number | null
          id?: string
          is_active?: boolean
          is_extra?: boolean
          max_completions?: number | null
          min_seconds_away?: number
          post_url?: string | null
          public_id?: string | null
          reaction_emoji?: string | null
          reward_pt?: number
          sub_recheck_minutes?: number
          title?: string | null
          type?: Database["public"]["Enums"]["task_type"]
        }
        Relationships: [
          {
            foreignKeyName: "tasks_advertiser_id_fkey"
            columns: ["advertiser_id"]
            isOneToOne: false
            referencedRelation: "advertisers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_ips: {
        Row: {
          first_seen_at: string
          id: string
          ip_address: unknown
          last_seen_at: string
          user_id: string
        }
        Insert: {
          first_seen_at?: string
          id?: string
          ip_address: unknown
          last_seen_at?: string
          user_id: string
        }
        Update: {
          first_seen_at?: string
          id?: string
          ip_address?: unknown
          last_seen_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_ips_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          balance_frozen: boolean
          balance_pt: number
          captcha_answer: number | null
          captcha_count: number
          captcha_pending: string | null
          created_at: string
          daily_bonus_at: string | null
          id: string
          is_banned: boolean
          is_suspicious: boolean
          referral_earnings_pt: number
          referrer_id: string | null
          telegram_id: number
          username: string | null
          violation_count: number
        }
        Insert: {
          balance_frozen?: boolean
          balance_pt?: number
          captcha_answer?: number | null
          captcha_count?: number
          captcha_pending?: string | null
          created_at?: string
          daily_bonus_at?: string | null
          id?: string
          is_banned?: boolean
          is_suspicious?: boolean
          referral_earnings_pt?: number
          referrer_id?: string | null
          telegram_id: number
          username?: string | null
          violation_count?: number
        }
        Update: {
          balance_frozen?: boolean
          balance_pt?: number
          captcha_answer?: number | null
          captcha_count?: number
          captcha_pending?: string | null
          created_at?: string
          daily_bonus_at?: string | null
          id?: string
          is_banned?: boolean
          is_suspicious?: boolean
          referral_earnings_pt?: number
          referrer_id?: string | null
          telegram_id?: number
          username?: string | null
          violation_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "users_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      video_ads: {
        Row: {
          advertiser_id: string | null
          created_at: string
          description: string | null
          duration_seconds: number
          external_link_label: string | null
          external_link_url: string | null
          id: string
          is_active: boolean
          is_extra: boolean
          media_type: string
          public_id: string | null
          reward_pt: number
          title: string
          video_url: string
        }
        Insert: {
          advertiser_id?: string | null
          created_at?: string
          description?: string | null
          duration_seconds: number
          external_link_label?: string | null
          external_link_url?: string | null
          id?: string
          is_active?: boolean
          is_extra?: boolean
          media_type?: string
          public_id?: string | null
          reward_pt?: number
          title: string
          video_url: string
        }
        Update: {
          advertiser_id?: string | null
          created_at?: string
          description?: string | null
          duration_seconds?: number
          external_link_label?: string | null
          external_link_url?: string | null
          id?: string
          is_active?: boolean
          is_extra?: boolean
          media_type?: string
          public_id?: string | null
          reward_pt?: number
          title?: string
          video_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_ads_advertiser_id_fkey"
            columns: ["advertiser_id"]
            isOneToOne: false
            referencedRelation: "advertisers"
            referencedColumns: ["id"]
          },
        ]
      }
      video_views: {
        Row: {
          checkpoints: Json
          finished_at: string | null
          id: string
          ip_address: unknown
          rewarded: boolean
          session_secret: string | null
          started_at: string
          user_id: string
          video_ad_id: string
        }
        Insert: {
          checkpoints?: Json
          finished_at?: string | null
          id?: string
          ip_address: unknown
          rewarded?: boolean
          session_secret?: string | null
          started_at?: string
          user_id: string
          video_ad_id: string
        }
        Update: {
          checkpoints?: Json
          finished_at?: string | null
          id?: string
          ip_address?: unknown
          rewarded?: boolean
          session_secret?: string | null
          started_at?: string
          user_id?: string
          video_ad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_views_video_ad_id_fkey"
            columns: ["video_ad_id"]
            isOneToOne: false
            referencedRelation: "video_ads"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawals: {
        Row: {
          amount_pt: number
          amount_stars: number
          created_at: string
          id: string
          ip_address: unknown
          processed_at: string | null
          status: Database["public"]["Enums"]["withdrawal_status"]
          user_id: string
        }
        Insert: {
          amount_pt: number
          amount_stars: number
          created_at?: string
          id?: string
          ip_address: unknown
          processed_at?: string | null
          status?: Database["public"]["Enums"]["withdrawal_status"]
          user_id: string
        }
        Update: {
          amount_pt?: number
          amount_stars?: number
          created_at?: string
          id?: string
          ip_address?: unknown
          processed_at?: string | null
          status?: Database["public"]["Enums"]["withdrawal_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      gen_public_id_prefixed: {
        Args: { _entity_id: string; _entity_type: string; _prefix: string }
        Returns: string
      }
      gen_public_id9: { Args: never; Returns: string }
    }
    Enums: {
      task_type: "subscribe" | "video" | "view_post" | "reaction" | "view_story"
      withdrawal_status: "pending" | "approved" | "rejected"
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
      task_type: ["subscribe", "video", "view_post", "reaction", "view_story"],
      withdrawal_status: ["pending", "approved", "rejected"],
    },
  },
} as const
