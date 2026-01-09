from __future__ import annotations

"""A small instrument + method catalog used by both the UI and the API.

This is intentionally "static" metadata (no market data). The UI fetches it to:
  - build instrument + method dropdowns
  - render the right inputs for each method
  - show the methodology tooltip text for the (i) icon
"""


CATALOG: dict[str, object] = {
    "version": "0.5",
    "market_params": [
        {
            "key": "spot",
            "label": "Spot",
            "type": "number",
            "default": 100.0,
            "min": 0.000001,
            "step": 0.01,
        },
        {
            "key": "rate",
            "label": "Rate (cc)",
            "type": "number",
            "default": 0.05,
            "step": 0.0001,
        },
        {
            "key": "dividend_yield",
            "label": "Dividend yield (cc)",
            "type": "number",
            "default": 0.0,
            "step": 0.0001,
        },
        {
            "key": "vol",
            "label": "Vol",
            "type": "number",
            "default": 0.2,
            "min": 0.000001,
            "step": 0.0001,
        },
    ],
    "instruments": [
        {
            "key": "vanilla",
            "label": "Vanilla option",
            "base_params": [
                {
                    "key": "option_type",
                    "label": "Type",
                    "type": "select",
                    "default": "call",
                    "options": [
                        {"value": "call", "label": "Call"},
                        {"value": "put", "label": "Put"},
                    ],
                },
                {"key": "strike", "label": "Strike", "type": "number", "default": 100.0, "min": 0.000001, "step": 0.01},
                {"key": "time_to_expiry", "label": "T (years)", "type": "number", "default": 1.0, "min": 0.000001, "step": 0.0001},
            ],
            "methods": [
                {
                    "key": "black_scholes",
                    "label": "Closed form (Black–Scholes)",
                    "note": "Analytical price + Greeks under lognormal diffusion with constant r, q, σ.",
                    "extra_params": [],
                },
                {
                    "key": "binomial_crr",
                    "label": "Binomial tree (CRR)",
                    "note": "Recombining Cox–Ross–Rubinstein lattice (risk-neutral p, backward induction). Greeks via bumps.",
                    "extra_params": [
                        {"key": "steps", "label": "Tree steps", "type": "number", "default": 200, "min": 10, "step": 1},
                    ],
                },
            ],
        },
        {
            "key": "american",
            "label": "American option",
            "base_params": [
                {
                    "key": "option_type",
                    "label": "Type",
                    "type": "select",
                    "default": "put",
                    "options": [
                        {"value": "call", "label": "Call"},
                        {"value": "put", "label": "Put"},
                    ],
                },
                {"key": "strike", "label": "Strike", "type": "number", "default": 100.0, "min": 0.000001, "step": 0.01},
                {"key": "time_to_expiry", "label": "T (years)", "type": "number", "default": 1.0, "min": 0.000001, "step": 0.0001},
            ],
            "methods": [
                {
                    "key": "binomial_crr",
                    "label": "Binomial tree (CRR)",
                    "note": "CRR lattice with early exercise: value = max(intrinsic, continuation) at each node.",
                    "extra_params": [
                        {"key": "steps", "label": "Tree steps", "type": "number", "default": 300, "min": 10, "step": 1},
                    ],
                }
            ],
        },
        {
            "key": "digital",
            "label": "Digital (cash-or-nothing)",
            "base_params": [
                {
                    "key": "option_type",
                    "label": "Type",
                    "type": "select",
                    "default": "call",
                    "options": [
                        {"value": "call", "label": "Call"},
                        {"value": "put", "label": "Put"},
                    ],
                },
                {"key": "strike", "label": "Strike", "type": "number", "default": 100.0, "min": 0.000001, "step": 0.01},
                {"key": "payout", "label": "Cash payout", "type": "number", "default": 1.0, "min": 0.000001, "step": 0.01},
                {"key": "time_to_expiry", "label": "T (years)", "type": "number", "default": 1.0, "min": 0.000001, "step": 0.0001},
            ],
            "methods": [
                {
                    "key": "black_scholes",
                    "label": "Closed form (Black–Scholes)",
                    "note": "Analytical discounted payout × N(±d2). Greeks via finite-difference bumps.",
                    "extra_params": [],
                }
            ],
        },
        {
            "key": "barrier",
            "label": "Barrier (knock-out)",
            "base_params": [
                {
                    "key": "option_type",
                    "label": "Type",
                    "type": "select",
                    "default": "call",
                    "options": [
                        {"value": "call", "label": "Call"},
                        {"value": "put", "label": "Put"},
                    ],
                },
                {"key": "strike", "label": "Strike", "type": "number", "default": 100.0, "min": 0.000001, "step": 0.01},
                {
                    "key": "barrier_direction",
                    "label": "Barrier",
                    "type": "select",
                    "default": "up",
                    "options": [
                        {"value": "up", "label": "Up-and-out"},
                        {"value": "down", "label": "Down-and-out"},
                    ],
                },
                {"key": "barrier_level", "label": "Barrier level", "type": "number", "default": 120.0, "min": 0.000001, "step": 0.01},
                {"key": "time_to_expiry", "label": "T (years)", "type": "number", "default": 1.0, "min": 0.000001, "step": 0.0001},
            ],
            "methods": [
                {
                    "key": "mc_discrete",
                    "label": "Monte Carlo (discrete monitoring)",
                    "note": "Simulates GBM paths with discrete barrier checks; fast but can miss intra-step hits.",
                    "extra_params": [
                        {"key": "paths", "label": "Paths", "type": "number", "default": 20000, "min": 1000, "step": 500},
                        {"key": "steps", "label": "Steps", "type": "number", "default": 96, "min": 10, "step": 1},
                        {"key": "seed", "label": "Seed", "type": "number", "default": 7, "min": 0, "step": 1},
                    ],
                },
                {
                    "key": "mc_bridge",
                    "label": "Monte Carlo (Brownian bridge)",
                    "note": "Adds a Brownian-bridge correction to reduce discrete barrier miss bias.",
                    "extra_params": [
                        {"key": "paths", "label": "Paths", "type": "number", "default": 20000, "min": 1000, "step": 500},
                        {"key": "steps", "label": "Steps", "type": "number", "default": 96, "min": 10, "step": 1},
                        {"key": "seed", "label": "Seed", "type": "number", "default": 7, "min": 0, "step": 1},
                    ],
                },
            ],
        },
        {
            "key": "asian",
            "label": "Asian option",
            "base_params": [
                {
                    "key": "option_type",
                    "label": "Type",
                    "type": "select",
                    "default": "call",
                    "options": [
                        {"value": "call", "label": "Call"},
                        {"value": "put", "label": "Put"},
                    ],
                },
                {"key": "strike", "label": "Strike", "type": "number", "default": 100.0, "min": 0.000001, "step": 0.01},
                {"key": "time_to_expiry", "label": "T (years)", "type": "number", "default": 1.0, "min": 0.000001, "step": 0.0001},
            ],
            "methods": [
                {
                    "key": "geometric_closed_form",
                    "label": "Geometric average (closed form)",
                    "note": "Closed-form for continuous geometric-average price under GBM (lognormal).",
                    "extra_params": [],
                },
                {
                    "key": "arithmetic_mc",
                    "label": "Arithmetic average (Monte Carlo)",
                    "note": "Simulates GBM paths; arithmetic average over N fixings; Greeks via bump-and-reprice.",
                    "extra_params": [
                        {"key": "fixings", "label": "Fixings", "type": "number", "default": 52, "min": 4, "step": 1},
                        {"key": "paths", "label": "Paths", "type": "number", "default": 30000, "min": 1000, "step": 500},
                        {"key": "seed", "label": "Seed", "type": "number", "default": 11, "min": 0, "step": 1},
                    ],
                },
            ],
        },
        {
            "key": "forward",
            "label": "Forward",
            "base_params": [
                {"key": "strike", "label": "Forward strike", "type": "number", "default": 100.0, "min": 0.000001, "step": 0.01},
                {"key": "time_to_expiry", "label": "T (years)", "type": "number", "default": 1.0, "min": 0.000001, "step": 0.0001},
            ],
            "methods": [
                {
                    "key": "discounted_forward",
                    "label": "Discounted forward value",
                    "note": "PV = S·e^{-qT} − K·e^{-rT}. (Vol ignored; Greeks via bumps.)",
                    "extra_params": [],
                }
            ],
        },
    ],
}
