"""src.agent — the CO-GRID AI coordination analyst.

Server-side agentic loop over an OpenAI-compatible endpoint (tensormux by
default). The model can only answer from real pipeline data — every fact
comes through a tool call into data/processed/*. The API key never leaves
the server (AGENT_API_KEY in .env, gitignored).
"""
