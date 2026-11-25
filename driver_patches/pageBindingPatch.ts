import type { Project } from "ts-morph";

// ---------------------
// server/pageBinding.ts
// ---------------------
export function patchPageBinding(project: Project) {
	const pageBindingSourceContent = `/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { source } from '../utils/isomorphic/oldUtilityScriptSerializers';

import type { SerializedValue } from '../utils/isomorphic/oldUtilityScriptSerializers';

export type BindingPayload = {
  name: string;
  seq: number;
  serializedArgs?: SerializedValue[];
};

function addPageBinding(bindingName: string, needsHandle: boolean, utilityScriptSerializersFactory: typeof source) {
  const { serializeAsCallArgument } = utilityScriptSerializersFactory;
  // eslint-disable-next-line no-restricted-globals
  const rawBinding = (globalThis as any)[bindingName];
  const registryKey = Symbol.for(bindingName);
  if (!rawBinding || rawBinding[registryKey]) return;
  const callbacks = new Map<number, { resolve: (value: any) => void; reject: (error: any) => void }>();
  const handles = new Map<number, any>();
  let lastSeq = 0;
  const dispatch = (args: any[]) => {
    if (needsHandle && args.slice(1).some(arg => arg !== undefined))
      throw new Error(\`exposeBindingHandle supports a single argument, \${args.length} received\`);
    const seq = ++lastSeq;
    const promise = new Promise((resolve, reject) => callbacks.set(seq, { resolve, reject }));
    let payload: BindingPayload;
    if (needsHandle) {
      handles.set(seq, args[0]);
      payload = { name: bindingName, seq };
    } else {
      const serializedArgs: SerializedValue[] = [];
      for (let i = 0; i < args.length; i++) {
        serializedArgs[i] = serializeAsCallArgument(args[i], v => {
          return { fallThrough: v };
        });
      }
      payload = { name: bindingName, seq, serializedArgs };
    }
    rawBinding(JSON.stringify(payload));
    return promise;
  };
  // A Proxy over an arrow function keeps Function.prototype.toString native and
  // exposes no callbacks/handles/lastSeq properties to page code.
  const target = (() => {}) as any;
  try { Object.defineProperty(target, 'name', { value: bindingName, configurable: true }); } catch {}
  const registry = { callbacks, handles };
  const wrapper = new Proxy(target, {
    apply(_target, _thisArg, args) { return dispatch(args as any[]); },
    get(_target, property) {
      if (property === registryKey) return registry;
      return Reflect.get(_target, property);
    },
  });
  // The registry lives only in the proxy's get trap. It is never installed as
  // an own symbol or string property on globalThis or on the exposed function.
  // eslint-disable-next-line no-restricted-globals
  (globalThis as any)[bindingName] = wrapper;
}
export function takeBindingHandle(arg: { name: string; seq: number }) {
  // eslint-disable-next-line no-restricted-globals
  const wrapper = (globalThis as any)[arg.name];
  const registry = wrapper ? wrapper[Symbol.for(arg.name)] : undefined;
  const handles = registry.handles;
  const handle = handles.get(arg.seq);
  handles.delete(arg.seq);
  return handle;
}

export function deliverBindingResult(arg: { name: string; seq: number; result?: any; error?: any }) {
  // eslint-disable-next-line no-restricted-globals
  const wrapper = (globalThis as any)[arg.name];
  const registry = wrapper ? wrapper[Symbol.for(arg.name)] : undefined;
  const callbacks = registry.callbacks;
  if ('error' in arg) callbacks.get(arg.seq).reject(arg.error);
  else callbacks.get(arg.seq).resolve(arg.result);
  callbacks.delete(arg.seq);
}

export function createPageBindingScript(name: string, needsHandle: boolean) {
  return \`(\${addPageBinding.toString()})(\${JSON.stringify(name)}, \${needsHandle}, (\${source})())\`;
}
`;

	project.createSourceFile("packages/playwright-core/src/server/pageBinding.ts", pageBindingSourceContent, {
		overwrite: true,
	});
}
