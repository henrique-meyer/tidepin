# ADR 0003: Demo sessions and scale to zero

Status: Accepted

The demo runs on Container Apps Consumption with zero minimum replicas and at most one replica. A visit wakes the app; after requests stop, the platform can scale it down following its idle cooldown. A tab that polls indefinitely would keep generating work even when its viewer has left.

Unlike the source display, this tide demo has no persistent push stream to close. `SESSION_LIMIT_MINUTES` therefore supplies a browser session timer through the uncached `/api/config` response. The server and infrastructure accept integers from 1 through 120; the demo default is 120 minutes. Unlimited sessions are deliberately excluded from this demo's existing bounded configuration contract.

Pressing Start display begins one in-memory session. The footer's NOAA source line shows `Session expires: H:mm`, rounded down to the whole minute, as in the source display. The timer compares elapsed time rather than counting interval callbacks: browser throttling cannot grant extra time. It uses the greater of wall-clock and monotonic elapsed time, retaining the largest elapsed value seen, so sleep and backward clock changes do not extend the session. A configuration response arriving after Start adjusts the original session, without restarting its clock. Missing, invalid or unavailable browser configuration retains a bounded 120-minute fallback.

At expiry the timer emits `tidepin:session-ended` once. The display returns to Start with “Your session has ended. Press Start display to continue.” Graph consumers stop polling, abort pending requests and ignore late responses. Session visibility checks run synchronously in the capture phase before a graph may resume on a foreground tab. Time left is hidden on Start; pressing Start again creates a fresh session with the same chosen station. Settings changes do not renew a session. Reloading presents Start as usual; a picker return starts a fresh display session. No timer state is persisted.

This is a cooperative client limit, not an authentication, billing or server quota boundary. A modified client can issue requests directly, an in-flight upstream request may finish after the browser aborts, and scale-to-zero timing belongs to the hosting platform. The app remains stateless without session records, a database, a push service or a keepalive request. Once ordinary display traffic stops, the hosting idle policy can act. NOAA predictions only; not for navigation.
