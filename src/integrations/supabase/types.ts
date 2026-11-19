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
      app_settings: {
        Row: {
          key: string
          value: Json
        }
        Insert: {
          key: string
          value: Json
        }
        Update: {
          key?: string
          value?: Json
        }
        Relationships: []
      }
      athletes: {
        Row: {
          bib: string
          created_at: number
          full_name: string
          gender: string | null
          house_id: number
          id: number
          level: string | null
          levels: string[]
        }
        Insert: {
          bib: string
          created_at: number
          full_name: string
          gender?: string | null
          house_id: number
          id?: number
          level?: string | null
          levels?: string[]
        }
        Update: {
          bib?: string
          created_at?: number
          full_name?: string
          gender?: string | null
          house_id?: number
          id?: number
          level?: string | null
          levels?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "athletes_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
        ]
      }
      audit: {
        Row: {
          action: string
          detail: string
          id: number
          ts: number
          user_id: number | null
          username: string | null
        }
        Insert: {
          action: string
          detail?: string
          id?: number
          ts: number
          user_id?: number | null
          username?: string | null
        }
        Update: {
          action?: string
          detail?: string
          id?: number
          ts?: number
          user_id?: number | null
          username?: string | null
        }
        Relationships: []
      }
      backups: {
        Row: {
          created_at: number
          data: Json
          id: number
          label: string
        }
        Insert: {
          created_at: number
          data: Json
          id?: number
          label: string
        }
        Update: {
          created_at?: number
          data?: Json
          id?: number
          label?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          created_at: string
          created_by: string | null
          gender: Database["public"]["Enums"]["event_gender"]
          id: string
          is_team: boolean
          level: Database["public"]["Enums"]["event_level"]
          measure: Database["public"]["Enums"]["measure_type"]
          name: string
          points_multiplier: number
          scheduled_time: string | null
          status: Database["public"]["Enums"]["event_status"]
          updated_at: string
          venue: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          gender?: Database["public"]["Enums"]["event_gender"]
          id?: string
          is_team?: boolean
          level?: Database["public"]["Enums"]["event_level"]
          measure?: Database["public"]["Enums"]["measure_type"]
          name: string
          points_multiplier?: number
          scheduled_time?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          updated_at?: string
          venue?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          gender?: Database["public"]["Enums"]["event_gender"]
          id?: string
          is_team?: boolean
          level?: Database["public"]["Enums"]["event_level"]
          measure?: Database["public"]["Enums"]["measure_type"]
          name?: string
          points_multiplier?: number
          scheduled_time?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          updated_at?: string
          venue?: string | null
        }
        Relationships: []
      }
      houses: {
        Row: {
          color: string
          id: number
          name: string
          sort: number
        }
        Insert: {
          color: string
          id?: number
          name: string
          sort?: number
        }
        Update: {
          color?: string
          id?: number
          name?: string
          sort?: number
        }
        Relationships: []
      }
      live_version: {
        Row: {
          id: number
          v: number
        }
        Insert: {
          id: number
          v?: number
        }
        Update: {
          id?: number
          v?: number
        }
        Relationships: []
      }
      points_scale: {
        Row: {
          points: number
          position: number
        }
        Insert: {
          points: number
          position: number
        }
        Update: {
          points?: number
          position?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          last_login: number | null
          staff_no: number
          username: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          last_login?: number | null
          staff_no?: number
          username?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          last_login?: number | null
          staff_no?: number
          username?: string | null
        }
        Relationships: []
      }
      results: {
        Row: {
          created_at: string
          event_id: string
          house: Database["public"]["Enums"]["house_name"]
          id: string
          participant_name: string
          performance: string | null
          position: number | null
          recorded_by: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_id: string
          house: Database["public"]["Enums"]["house_name"]
          id?: string
          participant_name: string
          performance?: string | null
          position?: number | null
          recorded_by?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          house?: Database["public"]["Enums"]["house_name"]
          id?: string
          participant_name?: string
          performance?: string | null
          position?: number | null
          recorded_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "results_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      sd_entries: {
        Row: {
          athlete_id: number | null
          event_id: number
          heat: number
          house_id: number
          id: number
          name: string
          perf_value: number | null
          performance: string
          status: string
          updated_at: number
          updated_by: number | null
        }
        Insert: {
          athlete_id?: number | null
          event_id: number
          heat?: number
          house_id: number
          id?: number
          name: string
          perf_value?: number | null
          performance?: string
          status?: string
          updated_at: number
          updated_by?: number | null
        }
        Update: {
          athlete_id?: number | null
          event_id?: number
          heat?: number
          house_id?: number
          id?: number
          name?: string
          perf_value?: number | null
          performance?: string
          status?: string
          updated_at?: number
          updated_by?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sd_entries_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sd_entries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "sd_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sd_entries_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
        ]
      }
      sd_events: {
        Row: {
          created_at: number
          gender: string | null
          heat_starts: Json
          id: number
          kind: string
          level: string
          measure: string
          name: string
          sched_time: string
          sort: number
          status: string
          updated_at: number
        }
        Insert: {
          created_at: number
          gender?: string | null
          heat_starts?: Json
          id?: number
          kind?: string
          level: string
          measure?: string
          name: string
          sched_time?: string
          sort?: number
          status?: string
          updated_at: number
        }
        Update: {
          created_at?: number
          gender?: string | null
          heat_starts?: Json
          id?: number
          kind?: string
          level?: string
          measure?: string
          name?: string
          sched_time?: string
          sort?: number
          status?: string
          updated_at?: number
        }
        Relationships: []
      }
      staff_sessions: {
        Row: {
          created_at: number
          expires_at: number
          profile_id: string
          token_hash: string
        }
        Insert: {
          created_at: number
          expires_at: number
          profile_id: string
          token_hash: string
        }
        Update: {
          created_at?: number
          expires_at?: number
          profile_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_sessions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
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
      can_record: { Args: { _user_id: string }; Returns: boolean }
      event_is_open: { Args: { _event_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      reset_all_results: { Args: never; Returns: undefined }
      sd_clear_heat_clock: {
        Args: { _event: number; _heat: number; _now: number }
        Returns: undefined
      }
      sd_start_heat: {
        Args: { _at: number; _event: number; _heat: number; _now: number }
        Returns: Json
      }
      sd_swap_results: {
        Args: { _a: number; _actor: number; _b: number; _now: number }
        Returns: undefined
      }
      set_user_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "recorder" | "viewer"
      event_gender: "boys" | "girls" | "open"
      event_level: "junior" | "intermediate" | "senior" | "mixed"
      event_status: "scheduled" | "in_progress" | "completed" | "finalised"
      house_name: "ravens" | "hawks" | "eagles" | "falcons"
      measure_type: "time" | "distance" | "height" | "score" | "placing"
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
    Enums: {
      app_role: ["admin", "recorder", "viewer"],
      event_gender: ["boys", "girls", "open"],
      event_level: ["junior", "intermediate", "senior", "mixed"],
      event_status: ["scheduled", "in_progress", "completed", "finalised"],
      house_name: ["ravens", "hawks", "eagles", "falcons"],
      measure_type: ["time", "distance", "height", "score", "placing"],
    },
  },
} as const
