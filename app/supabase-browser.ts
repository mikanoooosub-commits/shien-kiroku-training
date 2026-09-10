import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * ブラウザ(クライアントコンポーネント)用のSupabaseクライアント。
 * anon key のみを使う(公開されて良い値)。実際のアクセス制御は supabase/schema.sql の RLS が担う。
 */
export function createClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が設定されていません。.env.local を確認してください。"
    );
  }
  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
}
