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
      app_config: {
        Row: {
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      athlete_roles: {
        Row: {
          athlete_id: string
          role_id: number
        }
        Insert: {
          athlete_id: string
          role_id: number
        }
        Update: {
          athlete_id?: string
          role_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "athlete_roles_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_settings: {
        Row: {
          athlete_id: string
          birth_date: string | null
          cedera: string | null
          domisili: string | null
          gender: string | null
          height_cm: number | null
          id: string
          lthr: number | null
          max_hr: number | null
          resting_hr: number | null
          start_training_date: string | null
          updated_at: string | null
          weight_kg: number | null
        }
        Insert: {
          athlete_id: string
          birth_date?: string | null
          cedera?: string | null
          domisili?: string | null
          gender?: string | null
          height_cm?: number | null
          id?: string
          lthr?: number | null
          max_hr?: number | null
          resting_hr?: number | null
          start_training_date?: string | null
          updated_at?: string | null
          weight_kg?: number | null
        }
        Update: {
          athlete_id?: string
          birth_date?: string | null
          cedera?: string | null
          domisili?: string | null
          gender?: string | null
          height_cm?: number | null
          id?: string
          lthr?: number | null
          max_hr?: number | null
          resting_hr?: number | null
          start_training_date?: string | null
          updated_at?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "athlete_settings_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: true
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athletes: {
        Row: {
          auth_id: string | null
          created_at: string | null
          email: string
          id: string
          nama: string | null
          name: string
          registration_mode: string | null
          status: string
          whatsapp: string | null
        }
        Insert: {
          auth_id?: string | null
          created_at?: string | null
          email: string
          id?: string
          nama?: string | null
          name: string
          registration_mode?: string | null
          status?: string
          whatsapp?: string | null
        }
        Update: {
          auth_id?: string | null
          created_at?: string | null
          email?: string
          id?: string
          nama?: string | null
          name?: string
          registration_mode?: string | null
          status?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      body_metrics: {
        Row: {
          athlete_id: string
          bmr_kcal: number | null
          body_fat_pct: number | null
          body_water_pct: number | null
          created_at: string | null
          health_score: number | null
          id: string
          lean_body_mass_kg: number | null
          notes: string | null
          protein_pct: number | null
          recorded_date: string
          resting_hr: number | null
          seg_arm_left: number | null
          seg_arm_right: number | null
          seg_leg_left: number | null
          seg_leg_right: number | null
          seg_trunk: number | null
          skeletal_muscle_pct: number | null
          smi: number | null
          visceral_fat_index: number | null
          waist_cm: number | null
          weight_kg: number | null
        }
        Insert: {
          athlete_id: string
          bmr_kcal?: number | null
          body_fat_pct?: number | null
          body_water_pct?: number | null
          created_at?: string | null
          health_score?: number | null
          id?: string
          lean_body_mass_kg?: number | null
          notes?: string | null
          protein_pct?: number | null
          recorded_date: string
          resting_hr?: number | null
          seg_arm_left?: number | null
          seg_arm_right?: number | null
          seg_leg_left?: number | null
          seg_leg_right?: number | null
          seg_trunk?: number | null
          skeletal_muscle_pct?: number | null
          smi?: number | null
          visceral_fat_index?: number | null
          waist_cm?: number | null
          weight_kg?: number | null
        }
        Update: {
          athlete_id?: string
          bmr_kcal?: number | null
          body_fat_pct?: number | null
          body_water_pct?: number | null
          created_at?: string | null
          health_score?: number | null
          id?: string
          lean_body_mass_kg?: number | null
          notes?: string | null
          protein_pct?: number | null
          recorded_date?: string
          resting_hr?: number | null
          seg_arm_left?: number | null
          seg_arm_right?: number | null
          seg_leg_left?: number | null
          seg_leg_right?: number | null
          seg_trunk?: number | null
          skeletal_muscle_pct?: number | null
          smi?: number | null
          visceral_fat_index?: number | null
          waist_cm?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "body_metrics_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_invitations: {
        Row: {
          allowed_email: string[] | null
          assigned_to: string | null
          code: string
          created_at: string | null
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          max_uses: number | null
          role_id: number | null
          used: boolean | null
          used_count: number | null
        }
        Insert: {
          allowed_email?: string[] | null
          assigned_to?: string | null
          code: string
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          max_uses?: number | null
          role_id?: number | null
          used?: boolean | null
          used_count?: number | null
        }
        Update: {
          allowed_email?: string[] | null
          assigned_to?: string | null
          code?: string
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          max_uses?: number | null
          role_id?: number | null
          used?: boolean | null
          used_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "coach_invitations_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_invitations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_invitations_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      ews_entries: {
        Row: {
          athlete_id: string
          composite_score: number | null
          created_at: string | null
          entry_date: string
          fatigue: number | null
          hrv: number | null
          id: string
          mood: number | null
          motivation: number | null
          muscle_soreness: number | null
          notes: string | null
          resting_hr: number | null
          sleep_quality: number | null
          stress: number | null
        }
        Insert: {
          athlete_id: string
          composite_score?: number | null
          created_at?: string | null
          entry_date: string
          fatigue?: number | null
          hrv?: number | null
          id?: string
          mood?: number | null
          motivation?: number | null
          muscle_soreness?: number | null
          notes?: string | null
          resting_hr?: number | null
          sleep_quality?: number | null
          stress?: number | null
        }
        Update: {
          athlete_id?: string
          composite_score?: number | null
          created_at?: string | null
          entry_date?: string
          fatigue?: number | null
          hrv?: number | null
          id?: string
          mood?: number | null
          motivation?: number | null
          muscle_soreness?: number | null
          notes?: string | null
          resting_hr?: number | null
          sleep_quality?: number | null
          stress?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ews_entries_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          athlete_id: string
          group_id: string
          id: string
          joined_at: string | null
          status: string | null
        }
        Insert: {
          athlete_id: string
          group_id: string
          id?: string
          joined_at?: string | null
          status?: string | null
        }
        Update: {
          athlete_id?: string
          group_id?: string
          id?: string
          joined_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_members_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      group_programs: {
        Row: {
          coach_athlete_id: string
          created_at: string | null
          description: string | null
          end_date: string | null
          id: string
          is_active: boolean | null
          name: string
          start_date: string | null
        }
        Insert: {
          coach_athlete_id: string
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          start_date?: string | null
        }
        Update: {
          coach_athlete_id?: string
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_programs_coach_athlete_id_fkey"
            columns: ["coach_athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_history: {
        Row: {
          athlete_id: string
          created_at: string | null
          hr_type: string | null
          hr_value: number
          id: string
          notes: string | null
          recorded_date: string
        }
        Insert: {
          athlete_id: string
          created_at?: string | null
          hr_type?: string | null
          hr_value: number
          id?: string
          notes?: string | null
          recorded_date: string
        }
        Update: {
          athlete_id?: string
          created_at?: string | null
          hr_type?: string | null
          hr_value?: number
          id?: string
          notes?: string | null
          recorded_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_history_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string | null
          group_id: string | null
          id: string
          is_read: boolean | null
          recipient_athlete_id: string
          sender_athlete_id: string | null
          title: string
          type: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          group_id?: string | null
          id?: string
          is_read?: boolean | null
          recipient_athlete_id: string
          sender_athlete_id?: string | null
          title: string
          type?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string | null
          group_id?: string | null
          id?: string
          is_read?: boolean | null
          recipient_athlete_id?: string
          sender_athlete_id?: string | null
          title?: string
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_athlete_id_fkey"
            columns: ["recipient_athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_sender_athlete_id_fkey"
            columns: ["sender_athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition: {
        Row: {
          athlete_id: string
          content: string | null
          id: string
          section_key: string
          title: string | null
          updated_at: string | null
        }
        Insert: {
          athlete_id: string
          content?: string | null
          id?: string
          section_key: string
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          athlete_id?: string
          content?: string | null
          id?: string
          section_key?: string
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_log: {
        Row: {
          athlete_id: string
          created_at: string | null
          during_run_fuel: string | null
          electrolytes: string | null
          hydration_ml: number | null
          id: string
          log_date: string
          notes: string | null
          post_run_meal: string | null
          pre_run_meal: string | null
        }
        Insert: {
          athlete_id: string
          created_at?: string | null
          during_run_fuel?: string | null
          electrolytes?: string | null
          hydration_ml?: number | null
          id?: string
          log_date: string
          notes?: string | null
          post_run_meal?: string | null
          pre_run_meal?: string | null
        }
        Update: {
          athlete_id?: string
          created_at?: string | null
          during_run_fuel?: string | null
          electrolytes?: string | null
          hydration_ml?: number | null
          id?: string
          log_date?: string
          notes?: string | null
          post_run_meal?: string | null
          pre_run_meal?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_log_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      pace_zone_adjustments: {
        Row: {
          adjusted_at: string | null
          adjusted_by_athlete_id: string | null
          athlete_id: string | null
          id: string
          notes: string | null
          pct_override: number
          zone_key: string
        }
        Insert: {
          adjusted_at?: string | null
          adjusted_by_athlete_id?: string | null
          athlete_id?: string | null
          id?: string
          notes?: string | null
          pct_override: number
          zone_key: string
        }
        Update: {
          adjusted_at?: string | null
          adjusted_by_athlete_id?: string | null
          athlete_id?: string | null
          id?: string
          notes?: string | null
          pct_override?: number
          zone_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "pace_zone_adjustments_adjusted_by_athlete_id_fkey"
            columns: ["adjusted_by_athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pace_zone_adjustments_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_history: {
        Row: {
          athlete_id: string
          created_at: string | null
          id: string
          lthr: number | null
          notes: string | null
          recorded_at: string
          resting_hr: number | null
          weight_kg: number | null
        }
        Insert: {
          athlete_id: string
          created_at?: string | null
          id?: string
          lthr?: number | null
          notes?: string | null
          recorded_at: string
          resting_hr?: number | null
          weight_kg?: number | null
        }
        Update: {
          athlete_id?: string
          created_at?: string | null
          id?: string
          lthr?: number | null
          notes?: string | null
          recorded_at?: string
          resting_hr?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profile_history_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      program_sessions: {
        Row: {
          athlete_id: string
          coach_notes: string | null
          created_at: string | null
          day_of_week: number | null
          distance_km: number | null
          duration_min: number | null
          hr_zone: number | null
          id: string
          program_week_id: string
          rwr_run_sec: number | null
          rwr_walk_sec: number | null
          session_date: string | null
          session_type: string | null
          sort_order: number | null
          target_pace_min: number | null
          target_pace_sec: number | null
        }
        Insert: {
          athlete_id: string
          coach_notes?: string | null
          created_at?: string | null
          day_of_week?: number | null
          distance_km?: number | null
          duration_min?: number | null
          hr_zone?: number | null
          id?: string
          program_week_id: string
          rwr_run_sec?: number | null
          rwr_walk_sec?: number | null
          session_date?: string | null
          session_type?: string | null
          sort_order?: number | null
          target_pace_min?: number | null
          target_pace_sec?: number | null
        }
        Update: {
          athlete_id?: string
          coach_notes?: string | null
          created_at?: string | null
          day_of_week?: number | null
          distance_km?: number | null
          duration_min?: number | null
          hr_zone?: number | null
          id?: string
          program_week_id?: string
          rwr_run_sec?: number | null
          rwr_walk_sec?: number | null
          session_date?: string | null
          session_type?: string | null
          sort_order?: number | null
          target_pace_min?: number | null
          target_pace_sec?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "program_sessions_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_sessions_program_week_id_fkey"
            columns: ["program_week_id"]
            isOneToOne: false
            referencedRelation: "program_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      program_weeks: {
        Row: {
          actual_distance_km: number | null
          athlete_id: string
          created_at: string | null
          date_end: string | null
          date_start: string | null
          focus: string | null
          id: string
          notes: string | null
          phase: string | null
          program_id: string
          target_distance_km: number | null
          week_number: number
        }
        Insert: {
          actual_distance_km?: number | null
          athlete_id: string
          created_at?: string | null
          date_end?: string | null
          date_start?: string | null
          focus?: string | null
          id?: string
          notes?: string | null
          phase?: string | null
          program_id: string
          target_distance_km?: number | null
          week_number: number
        }
        Update: {
          actual_distance_km?: number | null
          athlete_id?: string
          created_at?: string | null
          date_end?: string | null
          date_start?: string | null
          focus?: string | null
          id?: string
          notes?: string | null
          phase?: string | null
          program_id?: string
          target_distance_km?: number | null
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "program_weeks_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_weeks_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          athlete_id: string
          created_at: string | null
          date_end: string | null
          date_start: string | null
          id: string
          name: string
          notes: string | null
          phase: string | null
          race_id: string | null
          status: string | null
        }
        Insert: {
          athlete_id: string
          created_at?: string | null
          date_end?: string | null
          date_start?: string | null
          id?: string
          name: string
          notes?: string | null
          phase?: string | null
          race_id?: string | null
          status?: string | null
        }
        Update: {
          athlete_id?: string
          created_at?: string | null
          date_end?: string | null
          date_start?: string | null
          id?: string
          name?: string
          notes?: string | null
          phase?: string | null
          race_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "programs_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programs_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_checklist_items: {
        Row: {
          athlete_id: string
          category: string | null
          created_at: string | null
          id: string
          is_checked: boolean | null
          label: string
          phase: string
          race_id: string | null
          sort_order: number | null
        }
        Insert: {
          athlete_id: string
          category?: string | null
          created_at?: string | null
          id?: string
          is_checked?: boolean | null
          label: string
          phase: string
          race_id?: string | null
          sort_order?: number | null
        }
        Update: {
          athlete_id?: string
          category?: string | null
          created_at?: string | null
          id?: string
          is_checked?: boolean | null
          label?: string
          phase?: string
          race_id?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "race_checklist_items_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_checklist_items_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_notes: {
        Row: {
          athlete_id: string
          content: string | null
          id: string
          phase: string | null
          race_id: string
          updated_at: string | null
        }
        Insert: {
          athlete_id: string
          content?: string | null
          id?: string
          phase?: string | null
          race_id: string
          updated_at?: string | null
        }
        Update: {
          athlete_id?: string
          content?: string | null
          id?: string
          phase?: string | null
          race_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "race_notes_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_notes_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      races: {
        Row: {
          actual_finish: string | null
          athlete_id: string
          city: string | null
          created_at: string | null
          distance_km: number | null
          event_date: string | null
          event_type: string | null
          id: string
          name: string
          notes: string | null
          slug: string
          status: string
          target_finish: string | null
          target_pace: string | null
          target_pace_min: number | null
          target_pace_sec: number | null
          updated_at: string | null
        }
        Insert: {
          actual_finish?: string | null
          athlete_id: string
          city?: string | null
          created_at?: string | null
          distance_km?: number | null
          event_date?: string | null
          event_type?: string | null
          id?: string
          name: string
          notes?: string | null
          slug: string
          status?: string
          target_finish?: string | null
          target_pace?: string | null
          target_pace_min?: number | null
          target_pace_sec?: number | null
          updated_at?: string | null
        }
        Update: {
          actual_finish?: string | null
          athlete_id?: string
          city?: string | null
          created_at?: string | null
          distance_km?: number | null
          event_date?: string | null
          event_type?: string | null
          id?: string
          name?: string
          notes?: string | null
          slug?: string
          status?: string
          target_finish?: string | null
          target_pace?: string | null
          target_pace_min?: number | null
          target_pace_sec?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "races_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission: string
          role_id: number
        }
        Insert: {
          permission: string
          role_id: number
        }
        Update: {
          permission?: string
          role_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          id: number
          name: string
        }
        Insert: {
          id?: number
          name: string
        }
        Update: {
          id?: number
          name?: string
        }
        Relationships: []
      }
      training_load: {
        Row: {
          acwr: number | null
          athlete_id: string
          atl: number | null
          created_at: string | null
          ctl: number | null
          daily_trimp: number | null
          id: string
          load_date: string
          tsb: number | null
        }
        Insert: {
          acwr?: number | null
          athlete_id: string
          atl?: number | null
          created_at?: string | null
          ctl?: number | null
          daily_trimp?: number | null
          id?: string
          load_date: string
          tsb?: number | null
        }
        Update: {
          acwr?: number | null
          athlete_id?: string
          atl?: number | null
          created_at?: string | null
          ctl?: number | null
          daily_trimp?: number | null
          id?: string
          load_date?: string
          tsb?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "training_load_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      training_sessions: {
        Row: {
          athlete_id: string
          created_at: string | null
          distance_km: number | null
          duration_sec: number | null
          hr_avg: number | null
          hr_max: number | null
          id: string
          notes: string | null
          pace_avg_min: number | null
          pace_avg_sec: number | null
          program_id: string | null
          rpe: number | null
          session_date: string
          session_type: string | null
          trimp: number | null
        }
        Insert: {
          athlete_id: string
          created_at?: string | null
          distance_km?: number | null
          duration_sec?: number | null
          hr_avg?: number | null
          hr_max?: number | null
          id?: string
          notes?: string | null
          pace_avg_min?: number | null
          pace_avg_sec?: number | null
          program_id?: string | null
          rpe?: number | null
          session_date: string
          session_type?: string | null
          trimp?: number | null
        }
        Update: {
          athlete_id?: string
          created_at?: string | null
          distance_km?: number | null
          duration_sec?: number | null
          hr_avg?: number | null
          hr_max?: number | null
          id?: string
          notes?: string | null
          pace_avg_min?: number | null
          pace_avg_sec?: number | null
          program_id?: string | null
          rpe?: number | null
          session_date?: string
          session_type?: string | null
          trimp?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "training_sessions_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_sessions_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_issues: {
        Row: {
          action: string
          athlete_id: string
          created_at: string | null
          decision_detail: string | null
          id: string
          severity: string
          sort_order: number | null
          symptom: string
        }
        Insert: {
          action: string
          athlete_id: string
          created_at?: string | null
          decision_detail?: string | null
          id?: string
          severity?: string
          sort_order?: number | null
          symptom: string
        }
        Update: {
          action?: string
          athlete_id?: string
          created_at?: string | null
          decision_detail?: string | null
          id?: string
          severity?: string
          sort_order?: number | null
          symptom?: string
        }
        Relationships: [
          {
            foreignKeyName: "treatment_issues_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_log: {
        Row: {
          athlete_id: string
          body_part: string | null
          created_at: string | null
          duration_min: number | null
          id: string
          log_date: string
          notes: string | null
          treatment_type: string | null
        }
        Insert: {
          athlete_id: string
          body_part?: string | null
          created_at?: string | null
          duration_min?: number | null
          id?: string
          log_date: string
          notes?: string | null
          treatment_type?: string | null
        }
        Update: {
          athlete_id?: string
          body_part?: string | null
          created_at?: string | null
          duration_min?: number | null
          id?: string
          log_date?: string
          notes?: string | null
          treatment_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "treatment_log_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_protocols: {
        Row: {
          athlete_id: string
          content: string | null
          id: string
          section_key: string
          title: string | null
          updated_at: string | null
        }
        Insert: {
          athlete_id: string
          content?: string | null
          id?: string
          section_key: string
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          athlete_id?: string
          content?: string | null
          id?: string
          section_key?: string
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "treatment_protocols_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      tt_history: {
        Row: {
          athlete_id: string
          created_at: string | null
          distance_km: number
          finish_time_sec: number
          hr_avg: number | null
          hr_partial_avg: number | null
          id: string
          lthr_calculated: number | null
          notes: string | null
          tt_date: string
          tt_type: string | null
          vdot: number | null
        }
        Insert: {
          athlete_id: string
          created_at?: string | null
          distance_km: number
          finish_time_sec: number
          hr_avg?: number | null
          hr_partial_avg?: number | null
          id?: string
          lthr_calculated?: number | null
          notes?: string | null
          tt_date: string
          tt_type?: string | null
          vdot?: number | null
        }
        Update: {
          athlete_id?: string
          created_at?: string | null
          distance_km?: number
          finish_time_sec?: number
          hr_avg?: number | null
          hr_partial_avg?: number | null
          id?: string
          lthr_calculated?: number | null
          notes?: string | null
          tt_date?: string
          tt_type?: string | null
          vdot?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tt_history_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      athlete_fitness: {
        Row: {
          acwr: number | null
          athlete_id: string | null
          atl: number | null
          ctl: number | null
          day: string | null
          tsb: number | null
        }
        Relationships: [
          {
            foreignKeyName: "training_sessions_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_delete_athlete: {
        Args: { p_athlete_id: string }
        Returns: undefined
      }
      claim_invite: {
        Args: { p_athlete_id: string; p_code: string; p_email?: string }
        Returns: number
      }
      delete_auth_user: { Args: { p_auth_id: string }; Returns: undefined }
      generate_invite_code:
        | { Args: { p_role_id?: number }; Returns: string }
        | {
            Args: {
              p_allowed_email?: string
              p_max_uses?: number
              p_role_id?: number
            }
            Returns: string
          }
        | {
            Args: {
              p_allowed_emails?: string[]
              p_max_uses?: number
              p_role_id?: number
            }
            Returns: string
          }
      get_group_fitness: {
        Args: { p_group_id: string }
        Returns: {
          acwr: number
          athlete_id: string
          atl: number
          ctl: number
          full_name: string
          last_session_date: string
          tsb: number
        }[]
      }
      get_my_athlete_id: { Args: never; Returns: string }
      get_my_fitness: {
        Args: never
        Returns: {
          acwr: number
          atl: number
          ctl: number
          day: string
          tsb: number
        }[]
      }
      get_my_group_athlete_ids: { Args: never; Returns: string[] }
      get_registration_policy: { Args: never; Returns: string }
      has_role: { Args: { role_name: string }; Returns: boolean }
      register_athlete:
        | {
            Args: { p_auth_id: string; p_email: string; p_name: string }
            Returns: undefined
          }
        | {
            Args: {
              p_auth_id?: string
              p_email: string
              p_invite_code?: string
              p_name: string
            }
            Returns: Json
          }
        | {
            Args: { p_email: string; p_invite_code?: string; p_name: string }
            Returns: Json
          }
      set_registration_policy: {
        Args: { p_policy: string }
        Returns: undefined
      }
      validate_invite_code: {
        Args: { p_code: string; p_email: string }
        Returns: string
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