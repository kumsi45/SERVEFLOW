import { useEffect, useState } from "react";
import { supabase } from "../../../core/database";

type StaffAuthStatus = "loading" | "authenticated" | "unauthenticated";

type StaffAuthSession = {
  status: StaffAuthStatus;
  userId: string | null;
};

export function useStaffAuthSession(): StaffAuthSession {
  const [session, setSession] = useState<StaffAuthSession>({
    status: "loading",
    userId: null,
  });

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, currentSession) => {
        if (
          event === "INITIAL_SESSION" ||
          event === "SIGNED_IN" ||
          event === "TOKEN_REFRESHED"
        ) {
          if (currentSession?.user) {
            setSession({ status: "authenticated", userId: currentSession.user.id });
          } else {
            setSession({ status: "unauthenticated", userId: null });
          }
        } else if (event === "SIGNED_OUT") {
          setSession({ status: "unauthenticated", userId: null });
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return session;
}
