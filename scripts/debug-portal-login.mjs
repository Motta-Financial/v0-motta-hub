import { createClient } from "@supabase/supabase-js"

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
  email: "jamie.rivera.test@example.com",
  password: "TestClient123!",
})

console.log("authError:", authError)
console.log("user id:", authData?.user?.id)

const { data, error } = await supabase
  .from("portal_users")
  .select("id, is_active, email, auth_user_id")
  .eq("email", "jamie.rivera.test@example.com")
  .maybeSingle()

console.log("query data:", data)
console.log("query error:", error)
