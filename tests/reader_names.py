import ast, builtins, sys
from reader_bundle import source

tree = ast.parse(source())
defined = set(dir(builtins))
for node in ast.walk(tree):
    if isinstance(node, (ast.FunctionDef, ast.ClassDef)): defined.add(node.name)
    elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store): defined.add(node.id)
    elif isinstance(node, ast.arg): defined.add(node.arg)
    elif isinstance(node, (ast.Import, ast.ImportFrom)): defined.update((a.asname or a.name).split(".")[0] for a in node.names)
    elif isinstance(node, ast.ExceptHandler) and node.name: defined.add(node.name)
used = {(n.id, n.lineno) for n in ast.walk(tree) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}
missing = sorted({name for name, _ in used if name not in defined})
print(("PASS" if not missing else "FAIL") + " every name the session reader uses is defined somewhere in it" + ("" if not missing else ": " + ", ".join(missing)))
sys.exit(1 if missing else 0)
