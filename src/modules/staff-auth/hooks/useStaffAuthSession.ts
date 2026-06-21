import { useEffect, useRef, useState } from "react";
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
  // Track whether INITIAL_SESSION has fired — starts false, prevents SIGNED_OUT
  // from a concurrent tab's signIn from logging out this tab before INITIAL_SESSION
  const initialSessionReceived = useRef(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, currentSession) => {
        if (event === "INITIAL_SESSION") {
          initialSessionReceived.current = true;
          if (currentSession?.user) {
            setSession({ status: "authenticated", userId: currentSession.user.id });
          } else {
            setSession({ status: "unauthenticated", userId: null });
          }
          return;
        }

        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
          if (currentSession?.user) {
            setSession({ status: "authenticated", userId: currentSession.user.id });
          }
          return;
        }

        if (event === "SIGNED_OUT") {
          // Only treat SIGNED_OUT as real if INITIAL_SESSION already confirmed
          // this tab is authenticated. This prevents a concurrent tab's
          // signIn → clearSession flow from logging out this dashboard.
          if (initialSessionReceived.current) {
            setSession({ status: "unauthenticated", userId: null });
          }
          return;
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return session;
}
