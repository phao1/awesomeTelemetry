The parallel job planner starts jobs before dependencies finish and silently returns partial plans for cycles. Repair Evaluate(graph) and its readiness helper. Graph maps job names to dependencies; dependency-only names are jobs too. Return waves of concurrently ready jobs, sorted within each wave. A job becomes ready only in the wave after all its dependencies have appeared. Return nil if any cycle remains. Empty input returns an allocated empty plan. Do not mutate the graph.

Keep the existing public entry point. Use only the standard library.
