Build ordering fails when a dependency is listed after its consumer and cycles recurse forever. Repair evaluate(graph), where graph maps job names to dependency names. Include dependency-only jobs. Return a deterministic dependency-first traversal: visit root keys and each dependency list in lexical order, emitting a job after its dependencies. Return null for any cycle, including self references. Do not modify graph.

Keep the existing public entry point. Use only the standard library.
