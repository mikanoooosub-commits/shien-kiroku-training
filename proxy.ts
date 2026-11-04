import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./app/database.types";
import { DEMO_SESSION_COOKIE, verifySessionToken } from "./app/demo-session";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * 全リクエストでSupabaseセッションを更新し、未ログインなら /login へリダイレクトする。
 * @supabase/ssr の推奨パターン: セッション更新はproxy(旧middleware。Next.js 16で名称変更)で一元的に行う
 * (Server Componentからはcookieを書き込めないことがあるため)。
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!supabaseUrl || !supabaseAnonKey) {
    // DBなしデモモード: Supabase未設定(停止中など)。認証・保存・施設共有は提供できない。
    // 「AIが6項目に振り分ける」体験だけを、合言葉ログインの内側で `/demo` で提供する(守り1段目=入口)。
    // 合言葉ゲートの中核は app/demo-session.ts(つもる tsumoru-poc から移植)。2段目は /demo ページと /api/structure 側で確かめる。
    const pathname = request.nextUrl.pathname;
    // ログイン画面(とそのServer Action POST)は常に開ける
    if (pathname === "/demo/login") return response;

    const loggedIn = verifySessionToken(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
    if (loggedIn) {
      // ログイン済み: 体験ページとAPI(実際に使うのは `/api/structure`、OpenAIのみ)を通す。それ以外は `/demo` へ。
      if (pathname === "/demo" || pathname.startsWith("/demo/") || pathname.startsWith("/api/")) {
        return response;
      }
      const url = request.nextUrl.clone();
      url.pathname = "/demo";
      return NextResponse.redirect(url);
    }

    // 未ログイン: APIは401、それ以外(ページ)は合言葉のログイン画面へ。
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/demo/login";
    return NextResponse.redirect(url);
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() は Supabase Auth サーバーにJWTを問い合わせて検証する。
  // getSession() はcookieの中身をそのまま信用するため、認可判定にはgetUser()を使う。
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAuthRoute = pathname.startsWith("/login");
  const isApiRoute = pathname.startsWith("/api");

  if (!user && isApiRoute) {
    return NextResponse.json({ error: "認証が必要です。ログインし直してください。" }, { status: 401 });
  }
  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
