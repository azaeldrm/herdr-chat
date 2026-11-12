ascii-sharks' simulation: fish schools (boids) and the sharks that hunt them.
From https://github.com/stackedlol/ascii-sharks at a0074c16a106f0abc665fe9712ca445f8f98ad8e, MIT (LICENSE here).

math.js, species.js and world.js are src/math.ts, src/species.ts and src/world.ts with their TypeScript types
stripped (Node's stripTypeScriptTypes, transform mode, which also drops comments) and ".js" added to their imports.
Nothing else is changed; don't edit them here. The renderer is not vendored: ../../scenes/sharks/cells.js and shapes.js port it to character cells.
