# STATE - live handoff

**Last finished:** B-294 refresh tokens stored as hashes, 2026-11-07, closed ○.

## Active work

None.

## Next

**B-297** Rate limits trust a client-sent `X-Forwarded-For` (the shell proxy forwards it), so single sign-on's discover and flow-start limits can be dodged by changing the header. Fresh session (user 2026-11-07: after B-294, in its own session). Shell, Gateway, Identity; security-sensitive, so run `security-review`. Otherwise B-211's verdict, then the board's Ready lane.
