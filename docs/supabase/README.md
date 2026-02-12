# Supabase Setup Checklist

1. Create a Supabase project in US region.
2. Run `docs/supabase/schema.sql` in SQL editor.
3. Enable Auth providers: Google and Email.
4. Add redirect allowlist for your bridge callback URL.
5. Put `supabaseUrl` and `supabaseAnonKey` into extension Options page.
6. In extension manifest, ensure `externally_connectable.matches` matches your bridge domain.
