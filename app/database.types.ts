/**
 * supabase/schema.sql と対応する型定義(手書き)。
 * Supabaseプロジェクト作成後は
 * `npx supabase gen types typescript --project-id <ref> > app/database.types.ts`
 * で生成し直し、手書き分とのズレを解消すること(CLAUDE.md「DBの列を追加したら型も必ず更新する」)。
 */

/** jsonb列の型。中身(6項目+uncertainNotes)の検証は record.ts の RecordSchema(zod)で行う。 */
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type Database = {
  public: {
    Tables: {
      facilities: {
        Row: {
          id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      facility_members: {
        Row: {
          id: string;
          facility_id: string;
          user_id: string;
          role: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          facility_id: string;
          user_id: string;
          role?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          facility_id?: string;
          user_id?: string;
          role?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      records: {
        Row: {
          id: string;
          facility_id: string;
          created_by: string | null;
          label: string;
          source_text: string;
          record: Json;
          child_id: string | null;
          record_date: string;
          saved_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          facility_id: string;
          created_by?: string | null;
          label?: string;
          source_text?: string;
          record: Json;
          child_id?: string | null;
          record_date?: string;
          saved_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          facility_id?: string;
          created_by?: string | null;
          label?: string;
          source_text?: string;
          record?: Json;
          child_id?: string | null;
          record_date?: string;
          saved_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      children: {
        Row: {
          id: string;
          facility_id: string;
          nickname: string;
          enrollment_year: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          facility_id: string;
          nickname: string;
          enrollment_year: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          facility_id?: string;
          nickname?: string;
          enrollment_year?: number;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      invite_to_facility: {
        Args: { target_facility_id: string; invitee_email: string };
        Returns: undefined;
      };
      is_facility_member: {
        Args: { target_facility_id: string };
        Returns: boolean;
      };
    };
  };
};
