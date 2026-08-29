// Relies on the Supabase UMD build being loaded first via a classic
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// tag, which attaches `supabase` to window.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
