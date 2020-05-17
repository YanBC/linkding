var linkding = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function prevent_default(fn) {
        return function (event) {
            event.preventDefault();
            // @ts-ignore
            return fn.call(this, event);
        };
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function toggle_class(element, name, toggle) {
        element.classList[toggle ? 'add' : 'remove'](name);
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    function flush() {
        const seen_callbacks = new Set();
        do {
            // first, call beforeUpdate functions
            // and update components
            while (dirty_components.length) {
                const component = dirty_components.shift();
                set_current_component(component);
                update(component.$$);
            }
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    callback();
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, value = ret) => {
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if ($$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(children(options.target));
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set() {
            // overridden by instance, if it has props
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, detail));
    }
    function append_dev(target, node) {
        dispatch_dev("SvelteDOMInsert", { target, node });
        append(target, node);
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev("SvelteDOMInsert", { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev("SvelteDOMRemove", { node });
        detach(node);
    }
    function listen_dev(node, event, handler, options, has_prevent_default, has_stop_propagation) {
        const modifiers = options === true ? ["capture"] : options ? Array.from(Object.keys(options)) : [];
        if (has_prevent_default)
            modifiers.push('preventDefault');
        if (has_stop_propagation)
            modifiers.push('stopPropagation');
        dispatch_dev("SvelteDOMAddEventListener", { node, event, handler, modifiers });
        const dispose = listen(node, event, handler, options);
        return () => {
            dispatch_dev("SvelteDOMRemoveEventListener", { node, event, handler, modifiers });
            dispose();
        };
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev("SvelteDOMRemoveAttribute", { node, attribute });
        else
            dispatch_dev("SvelteDOMSetAttribute", { node, attribute, value });
    }
    function prop_dev(node, property, value) {
        node[property] = value;
        dispatch_dev("SvelteDOMSetProperty", { node, property, value });
    }
    function set_data_dev(text, data) {
        data = '' + data;
        if (text.data === data)
            return;
        dispatch_dev("SvelteDOMSetData", { node: text, data });
        text.data = data;
    }
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error(`'target' is a required option`);
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn(`Component was already destroyed`); // eslint-disable-line no-console
            };
        }
    }

    /* bookmarks/components/TagAutocomplete.svelte generated by Svelte v3.16.7 */

    const file = "bookmarks/components/TagAutocomplete.svelte";

    function add_css() {
    	var style = element("style");
    	style.id = "svelte-nfqi2o-style";
    	style.textContent = ".menu.svelte-nfqi2o.svelte-nfqi2o{display:none;max-height:200px;overflow:auto}.menu.open.svelte-nfqi2o.svelte-nfqi2o{display:block}.menu-item.selected.svelte-nfqi2o>a.svelte-nfqi2o{background:#f1f1fc;color:#5755d9}\n/*# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiVGFnQXV0b2NvbXBsZXRlLnN2ZWx0ZSIsInNvdXJjZXMiOlsiVGFnQXV0b2NvbXBsZXRlLnN2ZWx0ZSJdLCJzb3VyY2VzQ29udGVudCI6WyI8c2NyaXB0PlxuICAgIGV4cG9ydCBsZXQgaWQ7XG4gICAgZXhwb3J0IGxldCBuYW1lO1xuICAgIGV4cG9ydCBsZXQgdmFsdWU7XG4gICAgZXhwb3J0IGxldCB0YWdzO1xuXG4gICAgbGV0IGlzRm9jdXMgPSBmYWxzZTtcbiAgICBsZXQgaXNPcGVuID0gZmFsc2U7XG4gICAgbGV0IGlucHV0ID0gbnVsbDtcblxuICAgIGxldCBzdWdnZXN0aW9ucyA9IFtdO1xuICAgIGxldCBzZWxlY3RlZEluZGV4ID0gMDtcblxuICAgIGZ1bmN0aW9uIGhhbmRsZUZvY3VzKCkge1xuICAgICAgICBpc0ZvY3VzID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBoYW5kbGVCbHVyKCkge1xuICAgICAgICBpc0ZvY3VzID0gZmFsc2U7XG4gICAgICAgIGNsb3NlKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaGFuZGxlSW5wdXQoZSkge1xuICAgICAgICBpbnB1dCA9IGUudGFyZ2V0O1xuXG4gICAgICAgIGNvbnN0IHdvcmQgPSBnZXRDdXJyZW50V29yZCgpO1xuXG4gICAgICAgIHN1Z2dlc3Rpb25zID0gd29yZCA/IHRhZ3MuZmlsdGVyKHRhZyA9PiB0YWcuaW5kZXhPZih3b3JkKSA9PT0gMCkgOiBbXTtcblxuICAgICAgICBpZiAod29yZCAmJiBzdWdnZXN0aW9ucy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBvcGVuKCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjbG9zZSgpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaGFuZGxlS2V5RG93bihlKSB7XG4gICAgICAgIGlmIChpc09wZW4gJiYgKGUua2V5Q29kZSA9PT0gMTMgfHwgZS5rZXlDb2RlID09PSA5KSkge1xuICAgICAgICAgICAgY29uc3Qgc3VnZ2VzdGlvbiA9IHN1Z2dlc3Rpb25zW3NlbGVjdGVkSW5kZXhdO1xuICAgICAgICAgICAgY29tcGxldGUoc3VnZ2VzdGlvbik7XG4gICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGUua2V5Q29kZSA9PT0gMjcpIHtcbiAgICAgICAgICAgIGNsb3NlKCk7XG4gICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGUua2V5Q29kZSA9PT0gMzgpIHtcbiAgICAgICAgICAgIHVwZGF0ZVNlbGVjdGlvbigtMSk7XG4gICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGUua2V5Q29kZSA9PT0gNDApIHtcbiAgICAgICAgICAgIHVwZGF0ZVNlbGVjdGlvbigxKTtcbiAgICAgICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIG9wZW4oKSB7XG4gICAgICAgIGlzT3BlbiA9IHRydWU7XG4gICAgICAgIHNlbGVjdGVkSW5kZXggPSAwO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNsb3NlKCkge1xuICAgICAgICBpc09wZW4gPSBmYWxzZTtcbiAgICAgICAgc3VnZ2VzdGlvbnMgPSBbXTtcbiAgICAgICAgc2VsZWN0ZWRJbmRleCA9IDA7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY29tcGxldGUoc3VnZ2VzdGlvbikge1xuICAgICAgICBjb25zdCBib3VuZHMgPSBnZXRDdXJyZW50V29yZEJvdW5kcyhpbnB1dCk7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gaW5wdXQudmFsdWU7XG4gICAgICAgIGlucHV0LnZhbHVlID0gdmFsdWUuc3Vic3RyaW5nKDAsIGJvdW5kcy5zdGFydCkgKyBzdWdnZXN0aW9uICsgdmFsdWUuc3Vic3RyaW5nKGJvdW5kcy5lbmQpO1xuXG4gICAgICAgIGNsb3NlKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZ2V0Q3VycmVudFdvcmRCb3VuZHMoKSB7XG4gICAgICAgIGNvbnN0IHRleHQgPSBpbnB1dC52YWx1ZTtcbiAgICAgICAgY29uc3QgZW5kID0gaW5wdXQuc2VsZWN0aW9uU3RhcnQ7XG4gICAgICAgIGxldCBzdGFydCA9IGVuZDtcblxuICAgICAgICBsZXQgY3VycmVudENoYXIgPSB0ZXh0LmNoYXJBdChzdGFydCAtIDEpO1xuXG4gICAgICAgIHdoaWxlIChjdXJyZW50Q2hhciAmJiBjdXJyZW50Q2hhciAhPT0gJyAnICYmIHN0YXJ0ID4gMCkge1xuICAgICAgICAgICAgc3RhcnQtLTtcbiAgICAgICAgICAgIGN1cnJlbnRDaGFyID0gdGV4dC5jaGFyQXQoc3RhcnQgLSAxKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7c3RhcnQsIGVuZH07XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZ2V0Q3VycmVudFdvcmQoKSB7XG4gICAgICAgIGNvbnN0IGJvdW5kcyA9IGdldEN1cnJlbnRXb3JkQm91bmRzKGlucHV0KTtcblxuICAgICAgICByZXR1cm4gaW5wdXQudmFsdWUuc3Vic3RyaW5nKGJvdW5kcy5zdGFydCwgYm91bmRzLmVuZCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdXBkYXRlU2VsZWN0aW9uKGRpcikge1xuXG4gICAgICAgIGNvbnN0IGxlbmd0aCA9IHN1Z2dlc3Rpb25zLmxlbmd0aDtcbiAgICAgICAgbGV0IG5ld0luZGV4ID0gc2VsZWN0ZWRJbmRleCArIGRpcjtcblxuICAgICAgICBpZiAobmV3SW5kZXggPCAwKSBuZXdJbmRleCA9IE1hdGgubWF4KGxlbmd0aCAtIDEsIDApO1xuICAgICAgICBpZiAobmV3SW5kZXggPj0gbGVuZ3RoKSBuZXdJbmRleCA9IDA7XG5cbiAgICAgICAgc2VsZWN0ZWRJbmRleCA9IG5ld0luZGV4O1xuICAgIH1cbjwvc2NyaXB0PlxuXG48ZGl2IGNsYXNzPVwiZm9ybS1hdXRvY29tcGxldGVcIj5cbiAgICA8IS0tIGF1dG9jb21wbGV0ZSBpbnB1dCBjb250YWluZXIgLS0+XG4gICAgPGRpdiBjbGFzcz1cImZvcm0tYXV0b2NvbXBsZXRlLWlucHV0IGZvcm0taW5wdXRcIiBjbGFzczppcy1mb2N1c2VkPXtpc0ZvY3VzfT5cbiAgICAgICAgPCEtLSBhdXRvY29tcGxldGUgcmVhbCBpbnB1dCBib3ggLS0+XG4gICAgICAgIDxpbnB1dCBpZD1cIntpZH1cIiBuYW1lPVwie25hbWV9XCIgdmFsdWU9XCJ7dmFsdWUgfHwnJ31cIlxuICAgICAgICAgICAgICAgY2xhc3M9XCJmb3JtLWlucHV0XCIgdHlwZT1cInRleHRcIiBhdXRvY29tcGxldGU9XCJvZmZcIlxuICAgICAgICAgICAgICAgb246aW5wdXQ9e2hhbmRsZUlucHV0fSBvbjprZXlkb3duPXtoYW5kbGVLZXlEb3dufVxuICAgICAgICAgICAgICAgb246Zm9jdXM9e2hhbmRsZUZvY3VzfSBvbjpibHVyPXtoYW5kbGVCbHVyfT5cbiAgICA8L2Rpdj5cblxuICAgIDwhLS0gYXV0b2NvbXBsZXRlIHN1Z2dlc3Rpb24gbGlzdCAtLT5cbiAgICA8dWwgY2xhc3M9XCJtZW51XCIgY2xhc3M6b3Blbj17aXNPcGVuICYmIHN1Z2dlc3Rpb25zLmxlbmd0aCA+IDB9PlxuICAgICAgICA8IS0tIG1lbnUgbGlzdCBpdGVtcyAtLT5cbiAgICAgICAgeyNlYWNoIHN1Z2dlc3Rpb25zIGFzIHRhZyxpfVxuICAgICAgICAgICAgPGxpIGNsYXNzPVwibWVudS1pdGVtXCIgY2xhc3M6c2VsZWN0ZWQ9e3NlbGVjdGVkSW5kZXggPT09IGl9PlxuICAgICAgICAgICAgICAgIDxhIGhyZWY9XCIjXCIgb246bW91c2Vkb3dufHByZXZlbnREZWZhdWx0PXsoKSA9PiBjb21wbGV0ZSh0YWcpfT5cbiAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cInRpbGUgdGlsZS1jZW50ZXJlZFwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cInRpbGUtY29udGVudFwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHt0YWd9XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgICAgPC9hPlxuICAgICAgICAgICAgPC9saT5cbiAgICAgICAgey9lYWNofVxuICAgIDwvdWw+XG48L2Rpdj5cblxuPHN0eWxlPlxuICAgIC5tZW51IHtcbiAgICAgICAgZGlzcGxheTogbm9uZTtcbiAgICAgICAgbWF4LWhlaWdodDogMjAwcHg7XG4gICAgICAgIG92ZXJmbG93OiBhdXRvO1xuICAgIH1cblxuICAgIC5tZW51Lm9wZW4ge1xuICAgICAgICBkaXNwbGF5OiBibG9jaztcbiAgICB9XG5cbiAgICAvKiBUT0RPOiBTaG91bGQgYmUgcmVhZCBmcm9tIHRoZW1lICovXG4gICAgLm1lbnUtaXRlbS5zZWxlY3RlZCA+IGEge1xuICAgICAgICBiYWNrZ3JvdW5kOiAjZjFmMWZjO1xuICAgICAgICBjb2xvcjogIzU3NTVkOTtcbiAgICB9XG48L3N0eWxlPiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUF3SUksS0FBSyw0QkFBQyxDQUFDLEFBQ0gsT0FBTyxDQUFFLElBQUksQ0FDYixVQUFVLENBQUUsS0FBSyxDQUNqQixRQUFRLENBQUUsSUFBSSxBQUNsQixDQUFDLEFBRUQsS0FBSyxLQUFLLDRCQUFDLENBQUMsQUFDUixPQUFPLENBQUUsS0FBSyxBQUNsQixDQUFDLEFBR0QsVUFBVSx1QkFBUyxDQUFHLENBQUMsY0FBQyxDQUFDLEFBQ3JCLFVBQVUsQ0FBRSxPQUFPLENBQ25CLEtBQUssQ0FBRSxPQUFPLEFBQ2xCLENBQUMifQ== */";
    	append_dev(document.head, style);
    }

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[20] = list[i];
    	child_ctx[22] = i;
    	return child_ctx;
    }

    // (122:8) {#each suggestions as tag,i}
    function create_each_block(ctx) {
    	let li;
    	let a;
    	let div1;
    	let div0;
    	let t0_value = /*tag*/ ctx[20] + "";
    	let t0;
    	let t1;
    	let dispose;

    	function mousedown_handler(...args) {
    		return /*mousedown_handler*/ ctx[19](/*tag*/ ctx[20], ...args);
    	}

    	const block = {
    		c: function create() {
    			li = element("li");
    			a = element("a");
    			div1 = element("div");
    			div0 = element("div");
    			t0 = text(t0_value);
    			t1 = space();
    			attr_dev(div0, "class", "tile-content");
    			add_location(div0, file, 125, 24, 3317);
    			attr_dev(div1, "class", "tile tile-centered");
    			add_location(div1, file, 124, 20, 3260);
    			attr_dev(a, "href", "#");
    			attr_dev(a, "class", "svelte-nfqi2o");
    			add_location(a, file, 123, 16, 3177);
    			attr_dev(li, "class", "menu-item svelte-nfqi2o");
    			toggle_class(li, "selected", /*selectedIndex*/ ctx[6] === /*i*/ ctx[22]);
    			add_location(li, file, 122, 12, 3101);
    			dispose = listen_dev(a, "mousedown", prevent_default(mousedown_handler), false, true, false);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, li, anchor);
    			append_dev(li, a);
    			append_dev(a, div1);
    			append_dev(div1, div0);
    			append_dev(div0, t0);
    			append_dev(li, t1);
    		},
    		p: function update(new_ctx, dirty) {
    			ctx = new_ctx;
    			if (dirty & /*suggestions*/ 32 && t0_value !== (t0_value = /*tag*/ ctx[20] + "")) set_data_dev(t0, t0_value);

    			if (dirty & /*selectedIndex*/ 64) {
    				toggle_class(li, "selected", /*selectedIndex*/ ctx[6] === /*i*/ ctx[22]);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(li);
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block.name,
    		type: "each",
    		source: "(122:8) {#each suggestions as tag,i}",
    		ctx
    	});

    	return block;
    }

    function create_fragment(ctx) {
    	let div1;
    	let div0;
    	let input_1;
    	let input_1_value_value;
    	let t;
    	let ul;
    	let dispose;
    	let each_value = /*suggestions*/ ctx[5];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	const block = {
    		c: function create() {
    			div1 = element("div");
    			div0 = element("div");
    			input_1 = element("input");
    			t = space();
    			ul = element("ul");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr_dev(input_1, "id", /*id*/ ctx[0]);
    			attr_dev(input_1, "name", /*name*/ ctx[1]);
    			input_1.value = input_1_value_value = /*value*/ ctx[2] || "";
    			attr_dev(input_1, "class", "form-input");
    			attr_dev(input_1, "type", "text");
    			attr_dev(input_1, "autocomplete", "off");
    			add_location(input_1, file, 112, 8, 2655);
    			attr_dev(div0, "class", "form-autocomplete-input form-input");
    			toggle_class(div0, "is-focused", /*isFocus*/ ctx[3]);
    			add_location(div0, file, 110, 4, 2526);
    			attr_dev(ul, "class", "menu svelte-nfqi2o");
    			toggle_class(ul, "open", /*isOpen*/ ctx[4] && /*suggestions*/ ctx[5].length > 0);
    			add_location(ul, file, 119, 4, 2955);
    			attr_dev(div1, "class", "form-autocomplete");
    			add_location(div1, file, 108, 0, 2448);

    			dispose = [
    				listen_dev(input_1, "input", /*handleInput*/ ctx[9], false, false, false),
    				listen_dev(input_1, "keydown", /*handleKeyDown*/ ctx[10], false, false, false),
    				listen_dev(input_1, "focus", /*handleFocus*/ ctx[7], false, false, false),
    				listen_dev(input_1, "blur", /*handleBlur*/ ctx[8], false, false, false)
    			];
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div1, anchor);
    			append_dev(div1, div0);
    			append_dev(div0, input_1);
    			append_dev(div1, t);
    			append_dev(div1, ul);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(ul, null);
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*id*/ 1) {
    				attr_dev(input_1, "id", /*id*/ ctx[0]);
    			}

    			if (dirty & /*name*/ 2) {
    				attr_dev(input_1, "name", /*name*/ ctx[1]);
    			}

    			if (dirty & /*value*/ 4 && input_1_value_value !== (input_1_value_value = /*value*/ ctx[2] || "")) {
    				prop_dev(input_1, "value", input_1_value_value);
    			}

    			if (dirty & /*isFocus*/ 8) {
    				toggle_class(div0, "is-focused", /*isFocus*/ ctx[3]);
    			}

    			if (dirty & /*selectedIndex, complete, suggestions*/ 2144) {
    				each_value = /*suggestions*/ ctx[5];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(ul, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}

    			if (dirty & /*isOpen, suggestions*/ 48) {
    				toggle_class(ul, "open", /*isOpen*/ ctx[4] && /*suggestions*/ ctx[5].length > 0);
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div1);
    			destroy_each(each_blocks, detaching);
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance($$self, $$props, $$invalidate) {
    	let { id } = $$props;
    	let { name } = $$props;
    	let { value } = $$props;
    	let { tags } = $$props;
    	let isFocus = false;
    	let isOpen = false;
    	let input = null;
    	let suggestions = [];
    	let selectedIndex = 0;

    	function handleFocus() {
    		$$invalidate(3, isFocus = true);
    	}

    	function handleBlur() {
    		$$invalidate(3, isFocus = false);
    		close();
    	}

    	function handleInput(e) {
    		input = e.target;
    		const word = getCurrentWord();
    		$$invalidate(5, suggestions = word ? tags.filter(tag => tag.indexOf(word) === 0) : []);

    		if (word && suggestions.length > 0) {
    			open();
    		} else {
    			close();
    		}
    	}

    	function handleKeyDown(e) {
    		if (isOpen && (e.keyCode === 13 || e.keyCode === 9)) {
    			const suggestion = suggestions[selectedIndex];
    			complete(suggestion);
    			e.preventDefault();
    		}

    		if (e.keyCode === 27) {
    			close();
    			e.preventDefault();
    		}

    		if (e.keyCode === 38) {
    			updateSelection(-1);
    			e.preventDefault();
    		}

    		if (e.keyCode === 40) {
    			updateSelection(1);
    			e.preventDefault();
    		}
    	}

    	function open() {
    		$$invalidate(4, isOpen = true);
    		$$invalidate(6, selectedIndex = 0);
    	}

    	function close() {
    		$$invalidate(4, isOpen = false);
    		$$invalidate(5, suggestions = []);
    		$$invalidate(6, selectedIndex = 0);
    	}

    	function complete(suggestion) {
    		const bounds = getCurrentWordBounds();
    		const value = input.value;
    		input.value = value.substring(0, bounds.start) + suggestion + value.substring(bounds.end);
    		close();
    	}

    	function getCurrentWordBounds() {
    		const text = input.value;
    		const end = input.selectionStart;
    		let start = end;
    		let currentChar = text.charAt(start - 1);

    		while (currentChar && currentChar !== " " && start > 0) {
    			start--;
    			currentChar = text.charAt(start - 1);
    		}

    		return { start, end };
    	}

    	function getCurrentWord() {
    		const bounds = getCurrentWordBounds();
    		return input.value.substring(bounds.start, bounds.end);
    	}

    	function updateSelection(dir) {
    		const length = suggestions.length;
    		let newIndex = selectedIndex + dir;
    		if (newIndex < 0) newIndex = Math.max(length - 1, 0);
    		if (newIndex >= length) newIndex = 0;
    		$$invalidate(6, selectedIndex = newIndex);
    	}

    	const writable_props = ["id", "name", "value", "tags"];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<TagAutocomplete> was created with unknown prop '${key}'`);
    	});

    	const mousedown_handler = tag => complete(tag);

    	$$self.$set = $$props => {
    		if ("id" in $$props) $$invalidate(0, id = $$props.id);
    		if ("name" in $$props) $$invalidate(1, name = $$props.name);
    		if ("value" in $$props) $$invalidate(2, value = $$props.value);
    		if ("tags" in $$props) $$invalidate(12, tags = $$props.tags);
    	};

    	$$self.$capture_state = () => {
    		return {
    			id,
    			name,
    			value,
    			tags,
    			isFocus,
    			isOpen,
    			input,
    			suggestions,
    			selectedIndex
    		};
    	};

    	$$self.$inject_state = $$props => {
    		if ("id" in $$props) $$invalidate(0, id = $$props.id);
    		if ("name" in $$props) $$invalidate(1, name = $$props.name);
    		if ("value" in $$props) $$invalidate(2, value = $$props.value);
    		if ("tags" in $$props) $$invalidate(12, tags = $$props.tags);
    		if ("isFocus" in $$props) $$invalidate(3, isFocus = $$props.isFocus);
    		if ("isOpen" in $$props) $$invalidate(4, isOpen = $$props.isOpen);
    		if ("input" in $$props) input = $$props.input;
    		if ("suggestions" in $$props) $$invalidate(5, suggestions = $$props.suggestions);
    		if ("selectedIndex" in $$props) $$invalidate(6, selectedIndex = $$props.selectedIndex);
    	};

    	return [
    		id,
    		name,
    		value,
    		isFocus,
    		isOpen,
    		suggestions,
    		selectedIndex,
    		handleFocus,
    		handleBlur,
    		handleInput,
    		handleKeyDown,
    		complete,
    		tags,
    		input,
    		open,
    		close,
    		getCurrentWordBounds,
    		getCurrentWord,
    		updateSelection,
    		mousedown_handler
    	];
    }

    class TagAutocomplete extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		if (!document.getElementById("svelte-nfqi2o-style")) add_css();
    		init(this, options, instance, create_fragment, safe_not_equal, { id: 0, name: 1, value: 2, tags: 12 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "TagAutocomplete",
    			options,
    			id: create_fragment.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || ({});

    		if (/*id*/ ctx[0] === undefined && !("id" in props)) {
    			console.warn("<TagAutocomplete> was created without expected prop 'id'");
    		}

    		if (/*name*/ ctx[1] === undefined && !("name" in props)) {
    			console.warn("<TagAutocomplete> was created without expected prop 'name'");
    		}

    		if (/*value*/ ctx[2] === undefined && !("value" in props)) {
    			console.warn("<TagAutocomplete> was created without expected prop 'value'");
    		}

    		if (/*tags*/ ctx[12] === undefined && !("tags" in props)) {
    			console.warn("<TagAutocomplete> was created without expected prop 'tags'");
    		}
    	}

    	get id() {
    		throw new Error("<TagAutocomplete>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set id(value) {
    		throw new Error("<TagAutocomplete>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get name() {
    		throw new Error("<TagAutocomplete>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set name(value) {
    		throw new Error("<TagAutocomplete>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get value() {
    		throw new Error("<TagAutocomplete>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set value(value) {
    		throw new Error("<TagAutocomplete>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get tags() {
    		throw new Error("<TagAutocomplete>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set tags(value) {
    		throw new Error("<TagAutocomplete>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    var index = {
        TagAutoComplete: TagAutocomplete
    };

    return index;

}());
//# sourceMappingURL=bundle.js.map
