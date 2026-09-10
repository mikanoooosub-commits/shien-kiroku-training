import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * サーバー(Server Component / Route Handler)用のSupabaseクライアント。
 * @supabase/ssr の推奨パターンに従い、cookieでセッションを読み書きする。
 * リクエストごとに新規作成すること(使い回さない)。
 */
export async function createClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が設定されていません。.env.local を確認してください。"
    );
  }
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component からの呼び出しでは cookie を書き込めないことがある。
          // middleware.ts がセッション更新を担っていれば無視してよい(公式ドキュメント通り)。
        }
      },
    },
  });
}
