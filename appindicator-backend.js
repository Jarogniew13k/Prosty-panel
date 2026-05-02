// Prosty Panel — appindicator-backend.js 
// Wersja finalna: Poprawiony D-Bus, bezpieczne usuwanie (Debounce) i naprawiony skaner rozmiarów

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import GdkPixbuf from 'gi://GdkPixbuf';

Gio._promisify(Gio.DBusProxy.prototype, 'call', 'call_finish');

const WATCHER_XML = `
<node>
  <interface name="org.kde.StatusNotifierWatcher">
    <method name="RegisterStatusNotifierItem"><arg type="s" name="service" direction="in"/></method>
    <method name="RegisterStatusNotifierHost"><arg type="s" name="service" direction="in"/></method>
    <property name="RegisteredStatusNotifierItems" type="as" access="read"/>
    <property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
    <property name="ProtocolVersion" type="i" access="read"/>
    <signal name="StatusNotifierItemRegistered"><arg type="s" name="service"/></signal>
    <signal name="StatusNotifierItemUnregistered"><arg type="s" name="service"/></signal>
    <signal name="StatusNotifierHostRegistered"><arg type="s" name="service"/></signal>
  </interface>
</node>`;

const ITEM_XML = `
<node>
  <interface name="org.kde.StatusNotifierItem">
    <property name="IconName" type="s" access="read"/>
    <property name="Id" type="s" access="read"/>
    <property name="Title" type="s" access="read"/>
    <property name="IconThemePath" type="s" access="read"/>
    <property name="ItemIsMenu" type="b" access="read"/>
    <property name="IconPixmap" type="a(iiay)" access="read"/>
    <property name="Menu" type="o" access="read"/>
    <method name="Activate"><arg type="i" name="x"/><arg type="i" name="y"/></method>
    <method name="ContextMenu"><arg type="i" name="x"/><arg type="i" name="y"/></method>
    <method name="SecondaryActivate"><arg type="i" name="x"/><arg type="i" name="y"/></method>
    <method name="Scroll"><arg type="i" name="delta"/><arg type="s" name="orientation"/></method>
  </interface>
</node>`;

const MENU_XML = `
<node>
  <interface name="com.canonical.dbusmenu">
    <method name="GetLayout">
      <arg name="parentId" type="i" direction="in"/>
      <arg name="recursionDepth" type="i" direction="in"/>
      <arg name="propertyNames" type="as" direction="in"/>
      <arg name="revision" type="u" direction="out"/>
      <arg name="layout" type="(ia{sv}av)" direction="out"/>
    </method>
    <method name="Event">
      <arg name="id" type="i" direction="in"/>
      <arg name="eventId" type="s" direction="in"/>
      <arg name="data" type="v" direction="in"/>
      <arg name="timestamp" type="u" direction="in"/>
    </method>
  </interface>
</node>`;

const safeUnpack = (variant) => {
    if (!variant) return null;
    let v = variant;
    try {
        while (v instanceof GLib.Variant) {
            v = typeof v.deep_unpack === 'function' ? v.deep_unpack() : v.unpack();
        }
    } catch(e) {}
    return v;
};

// 🟢 FIX: Dodałem większe rozmiary (512, 256, 128, 96, 64) żeby znajdować ikony Discorda i Heroic!
function _findIconFile(baseName, searchPaths) {
    if (!baseName) return null;
    const exts = ['.png', '.svg', '.xpm', ''];
    const sizes = ['scalable', '512x512', '256x256', '128x128', '96x96', '64x64', '48x48', '32x32', '24x24', '22x22', '16x16'];
    const cats = ['apps', 'status', 'devices'];

    for (const dir of searchPaths) {
        if (!dir) continue;
        for (const ext of exts) {
            const f = Gio.File.new_for_path(`${dir}/${baseName}${ext}`);
            if (f.query_exists(null)) return f.get_path();
        }
        for (const size of sizes) {
            for (const cat of cats) {
                for (const ext of exts) {
                    const f = Gio.File.new_for_path(`${dir}/hicolor/${size}/${cat}/${baseName}${ext}`);
                    if (f.query_exists(null)) return f.get_path();
                }
            }
        }
    }
    return null;
}

function _buildAbsoluteIconPath(iconName, iconThemePath) {
    if (!iconName) return null;
    if (iconName.startsWith('/')) {
        const f = Gio.File.new_for_path(iconName);
        return f.query_exists(null) ? iconName : null;
    }

    const paths = [];

    if (iconThemePath) {
        paths.push(iconThemePath);
        const sizes = ['scalable', '512x512', '256x256', '128x128', '96x96', '64x64', '48x48', '32x32', '24x24', '22x22', '16x16'];
        const cats  = ['apps', 'status', 'devices'];
        for (const size of sizes) {
            for (const cat of cats) {
                paths.push(`${iconThemePath}/${size}/${cat}`);
            }
        }
    }

    paths.push(
        '/usr/share/pixmaps',
        '/usr/local/share/pixmaps',
        `${GLib.get_home_dir()}/.local/share/pixmaps`,
        '/usr/share/icons/hicolor',
        '/usr/local/share/icons/hicolor',
        `${GLib.get_home_dir()}/.local/share/icons/hicolor`
    );

    return _findIconFile(iconName, paths);
}

function _createPixbufFromPixmap(pixmapProp) {
    if (!pixmapProp) return null;
    try {
        let pixmaps = safeUnpack(pixmapProp);
        if (!Array.isArray(pixmaps) || pixmaps.length === 0) return null;

        let best = pixmaps[0];
        for (let p of pixmaps) { if (p[0] >= 16 && p[0] <= 48) best = p; }
        if (!best || !best[2]) return null;

        const raw = best[2] instanceof Uint8Array ? best[2] : new Uint8Array(best[2]);

        const rgba = new Uint8Array(raw.length);
        let hasVisiblePixels = false;
        for (let i = 0; i < raw.length; i += 4) {
            rgba[i]     = raw[i + 1]; 
            rgba[i + 1] = raw[i + 2]; 
            rgba[i + 2] = raw[i + 3]; 
            rgba[i + 3] = raw[i];     
            if (rgba[i + 3] > 0) hasVisiblePixels = true;
        }

        if (!hasVisiblePixels) return null;

        const bytes = new GLib.Bytes(rgba);
        return GdkPixbuf.Pixbuf.new_from_bytes(
            bytes,
            GdkPixbuf.Colorspace.RGB,
            true,   
            8,      
            best[0], best[1],
            best[0] * 4
        );
    } catch (e) {
        return null;
    }
}

async function _getDesktopIcon(busName) {
    try {
        const connection = Gio.DBus.session;
        return await new Promise((resolve) => {
            connection.call(
                busName, '/', 'org.freedesktop.DBus',
                'GetConnectionUnixProcessID', null, null,
                Gio.DBusCallFlags.NONE, -1, null,
                (conn, res) => {
                    try {
                        const reply = conn.call_finish(res);
                        const [pidVariant] = reply.deep_unpack();
                        const pid = pidVariant;
                        if (!pid) return resolve(null);

                        const app = Shell.WindowTracker.get_default().get_app_from_pid(pid);
                        if (!app) return resolve(null);
                        const appInfo = app.get_app_info();
                        if (!appInfo) return resolve(null);

                        const icon = appInfo.get_icon();
                        if (!icon) return resolve(null);

                        if (icon instanceof Gio.FileIcon) return resolve(icon.get_file().get_path());
                        if (icon instanceof Gio.ThemedIcon) {
                            const names = icon.get_names?.() || [];
                            for (const name of names) {
                                const p = _buildAbsoluteIconPath(name, null);
                                if (p) return resolve(p);
                            }
                        }
                        resolve(null);
                    } catch (e) {
                        resolve(null);
                    }
                }
            );
        });
    } catch (e) { 
        return null; 
    }
}

function _getAppInfoGIcon(iconName, id, title) {
    let rawTerms = [iconName, id, title].filter(Boolean);
    let searchTerms = rawTerms.map(t => t.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/[0-9]+$/, '').trim());
    searchTerms = [...new Set(searchTerms)].filter(t => t.length >= 2); 

    if (searchTerms.length === 0) return null;

    try {
        let apps = Gio.AppInfo.get_all();
        for (let term of searchTerms) {
            for (let app of apps) {
                let appId = (app.get_id() || '').toLowerCase();
                let appExec = (app.get_executable() || '').toLowerCase();
                let appName = (app.get_name() || '').toLowerCase();

                if (appId.includes(term) || appExec.includes(term) || appName.includes(term)) {
                    const icon = app.get_icon();
                    if (icon) return icon;
                }
            }
        }
    } catch(e) {}
    return null;
}

export const TrayBackend = GObject.registerClass({
    GTypeName: 'ProstyPanelTrayBackend',
    Signals: {
        'item-added':   { param_types: [GObject.TYPE_STRING, GObject.TYPE_JSOBJECT] },
        'item-removed': { param_types: [GObject.TYPE_STRING] },
    }
}, class TrayBackend extends GObject.Object {
    _init() {
        super._init();
        this._items = new Map();
        this._refreshTimeouts = new Map();
        this._unregisterTimeouts = new Map(); // Kontroler usuwania ikon
        this._rawSignals = new Map(); 
        this._dbus = Gio.DBus.session;
        this._initDualMode();
    }

    async _initDualMode() {
        try {
            this._watcherProxy = new Gio.DBusProxy({ g_connection: this._dbus, g_name: 'org.kde.StatusNotifierWatcher', g_object_path: '/StatusNotifierWatcher', g_interface_name: 'org.kde.StatusNotifierWatcher' });
            await this._watcherProxy.init_async(GLib.PRIORITY_DEFAULT, null);

            if (this._watcherProxy.g_name_owner) {
                const itemsVar = this._watcherProxy.get_cached_property('RegisteredStatusNotifierItems');
                if (itemsVar) {
                    const items = safeUnpack(itemsVar);
                    if (Array.isArray(items)) for (const service of items) this._registerItem(service);
                }
                
                // 🟢 FIX: Ochrona przed wyścigiem zdarzeń w Electronie
                this._watcherProxy.connectSignal('StatusNotifierItemRegistered', (proxy, sender, params) => { 
                    const service = safeUnpack(params)[0];
                    // Jeśli chcieliśmy to usunąć, ale jednak wraca - anulujemy usuwanie!
                    if (this._unregisterTimeouts.has(service)) {
                        GLib.source_remove(this._unregisterTimeouts.get(service));
                        this._unregisterTimeouts.delete(service);
                    }
                    if (this._items.has(service)) {
                        this._scheduleIconRefresh(service);
                    } else {
                        this._registerItem(service);
                    }
                });
                
                this._watcherProxy.connectSignal('StatusNotifierItemUnregistered', (proxy, sender, params) => { 
                    this._requestUnregister(safeUnpack(params)[0], false); // fałsz = poczekaj 500ms
                });
            } else {
                this._hostOwnWatcher();
            }
        } catch (e) { 
            this._hostOwnWatcher(); 
        }
    }

    _hostOwnWatcher() {
        const nodeInfo = Gio.DBusNodeInfo.new_for_xml(WATCHER_XML);
        this._regId = this._dbus.register_object(
            '/StatusNotifierWatcher', nodeInfo.interfaces[0],
            (conn, sender, path, iface, method, params, invocation) => {
                if (method === 'RegisterStatusNotifierItem') {
                    let service = String(safeUnpack(params)[0]);
                    if (service.startsWith('/')) service = sender + service;
                    
                    if (this._unregisterTimeouts.has(service)) {
                        GLib.source_remove(this._unregisterTimeouts.get(service));
                        this._unregisterTimeouts.delete(service);
                    }
                    if (this._items.has(service)) {
                        this._scheduleIconRefresh(service);
                    } else {
                        this._registerItem(service);
                    }
                    invocation.return_value(null);
                } else if (method === 'RegisterStatusNotifierHost') {
                    invocation.return_value(null);
                }
            }, 
            (conn, sender, path, iface, prop) => {
                if (prop === 'RegisteredStatusNotifierItems') return new GLib.Variant('as', Array.from(this._items.keys()));
                if (prop === 'IsStatusNotifierHostRegistered') return new GLib.Variant('b', true); 
                if (prop === 'ProtocolVersion') return new GLib.Variant('i', 1);
                return null;
            }, 
            null
        );
        this._ownNameId = Gio.bus_own_name_on_connection(this._dbus, 'org.kde.StatusNotifierWatcher', Gio.BusNameOwnerFlags.REPLACE, null, null);
    }

    async _registerItem(service) {
        if (!service || typeof service !== 'string' || this._items.has(service)) return;
        try {
            let [bus, path] = service.includes('/') ? [service.split('/')[0], '/' + service.split('/').slice(1).join('/')] : [service, '/StatusNotifierItem'];

            const proxy = new Gio.DBusProxy({
                g_connection: this._dbus,
                g_interface_name: 'org.kde.StatusNotifierItem',
                g_interface_info: Gio.DBusInterfaceInfo.new_for_xml(ITEM_XML),
                g_name: bus, g_object_path: path
            });
            await proxy.init_async(GLib.PRIORITY_DEFAULT, null);

            // Jeśli program naprawdę umarł w systemie - zabijamy natychmiast
            const ownerChangedId = proxy.connect('notify::g-name-owner', () => {
                if (!proxy.g_name_owner) {
                    this._requestUnregister(service, true); // prawda = usuń natychmiast
                }
            });

            const propSignalId = proxy.connect('g-properties-changed', () => {
                this._scheduleIconRefresh(service);
            });

            const sigId1 = this._dbus.signal_subscribe(bus, 'org.kde.StatusNotifierItem', 'NewIcon', path, null, Gio.DBusSignalFlags.NONE, () => this._scheduleIconRefresh(service));
            const sigId2 = this._dbus.signal_subscribe(bus, 'org.kde.StatusNotifierItem', 'NewTitle', path, null, Gio.DBusSignalFlags.NONE, () => this._scheduleIconRefresh(service));
            
            this._rawSignals.set(service, { propSignalId, sigId1, sigId2, ownerChangedId });

            const itemData = await this._buildItemData(service, proxy, bus);
            if (!itemData) return;

            this._items.set(service, itemData);
            this.emit('item-added', service, itemData);
            
            this._scheduleIconRefresh(service);
        } catch (e) {}
    }

    // 🟢 FIX: Kontroler Usuwania (Debounce)
    _requestUnregister(service, immediate = false) {
        if (immediate) {
            if (this._unregisterTimeouts.has(service)) {
                GLib.source_remove(this._unregisterTimeouts.get(service));
                this._unregisterTimeouts.delete(service);
            }
            this._performUnregister(service);
            return;
        }

        if (this._unregisterTimeouts.has(service)) return;

        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._performUnregister(service);
            this._unregisterTimeouts.delete(service);
            return GLib.SOURCE_REMOVE;
        });
        this._unregisterTimeouts.set(service, timeoutId);
    }

    _performUnregister(service) {
        this._clearRefreshTimeouts(service);
        const sigs = this._rawSignals.get(service);
        if (sigs) {
            const item = this._items.get(service);
            if (item && item.proxy) {
                try { item.proxy.disconnect(sigs.propSignalId); } catch(e){}
                try { item.proxy.disconnect(sigs.ownerChangedId); } catch(e){}
            }
            try { this._dbus.signal_unsubscribe(sigs.sigId1); } catch(e){}
            try { this._dbus.signal_unsubscribe(sigs.sigId2); } catch(e){}
            this._rawSignals.delete(service);
        }
        if (this._items.has(service)) {
            this._items.delete(service);
            this.emit('item-removed', service);
        }
    }

    _scheduleIconRefresh(service) {
        this._clearRefreshTimeouts(service);
        const timeouts = [];
        const createTimeout = (delay) => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._removeRefreshId(service, id);
                this._refreshItem(service).catch(e => {});
                return GLib.SOURCE_REMOVE;
            });
            timeouts.push(id);
        };
        [2000, 5000].forEach(delay => createTimeout(delay));
        this._refreshTimeouts.set(service, timeouts);
    }

    _removeRefreshId(service, id) {
        const timeouts = this._refreshTimeouts.get(service);
        if (timeouts) {
            const index = timeouts.indexOf(id);
            if (index !== -1) timeouts.splice(index, 1);
        }
    }

    _clearRefreshTimeouts(service) {
        const timeouts = this._refreshTimeouts.get(service);
        if (timeouts) {
            for (const id of timeouts) GLib.source_remove(id);
            this._refreshTimeouts.delete(service);
        }
    }

    async _refreshItem(service) {
        const item = this._items.get(service);
        if (!item) return;
        const proxy = item.proxy;

        for (const prop of ['IconName', 'IconPixmap', 'IconThemePath', 'Id', 'Title', 'ItemIsMenu', 'Menu']) {
            try {
                const reply = await proxy.get_connection().call(
                    proxy.g_name,
                    proxy.g_object_path,
                    'org.freedesktop.DBus.Properties',
                    'Get',
                    new GLib.Variant('(ss)', ['org.kde.StatusNotifierItem', prop]),
                    null,
                    Gio.DBusCallFlags.NONE,
                    1000, 
                    null
                );
                
                if (reply) {
                    const resultVariant = reply.get_child_value(0);
                    proxy.set_cached_property(prop, resultVariant.get_variant());
                }
            } catch (e) {}
        }

        if (!this._items.has(service)) return;

        const iconName      = safeUnpack(proxy.get_cached_property('IconName'));
        const id            = safeUnpack(proxy.get_cached_property('Id'));
        const title         = safeUnpack(proxy.get_cached_property('Title'));
        const iconThemePath = safeUnpack(proxy.get_cached_property('IconThemePath'));

        let absoluteIconPath = _buildAbsoluteIconPath(iconName, iconThemePath);
        if (!absoluteIconPath) absoluteIconPath = await _getDesktopIcon(proxy.g_name);
        
        if (!this._items.has(service)) return;
        
        if (!absoluteIconPath && id) {
            absoluteIconPath = _findIconFile(id, [
                '/usr/share/pixmaps', 
                '/usr/local/share/pixmaps',
                `${GLib.get_home_dir()}/.local/share/pixmaps`,
                '/usr/share/icons/hicolor'
            ]);
        }

        const pixmapProp = proxy.get_cached_property('IconPixmap');
        const pixbuf = _createPixbufFromPixmap(pixmapProp);

        let iconNames = [];
        if (iconName) iconNames.push(iconName);
        if (id) { iconNames.push(id); iconNames.push(id.toLowerCase()); }

        item.absoluteIconPath = absoluteIconPath;
        item.pixbuf = pixbuf;
        item.iconNames = iconNames;
        item.title = title || id;
        item.fallbackGIcon = _getAppInfoGIcon(iconName, id, title);

        this.emit('item-added', service, item);
    }

    async _buildItemData(service, proxy, bus) {
        const iconName      = safeUnpack(proxy.get_cached_property('IconName'));
        const id            = safeUnpack(proxy.get_cached_property('Id'));
        const title         = safeUnpack(proxy.get_cached_property('Title'));
        const iconThemePath = safeUnpack(proxy.get_cached_property('IconThemePath'));
        const itemIsMenu    = safeUnpack(proxy.get_cached_property('ItemIsMenu'));

        let absoluteIconPath = _buildAbsoluteIconPath(iconName, iconThemePath);
        if (!absoluteIconPath) absoluteIconPath = await _getDesktopIcon(proxy.g_name);
        
        if (!absoluteIconPath && id) {
            absoluteIconPath = _findIconFile(id, [
                '/usr/share/pixmaps', 
                '/usr/local/share/pixmaps',
                `${GLib.get_home_dir()}/.local/share/pixmaps`,
                '/usr/share/icons/hicolor'
            ]);
        }

        const pixmapProp = proxy.get_cached_property('IconPixmap');
        const pixbuf = _createPixbufFromPixmap(pixmapProp);

        let iconNames = [];
        if (iconName) iconNames.push(iconName);
        if (id) { iconNames.push(id); iconNames.push(id.toLowerCase()); }
        if (iconNames.length === 0) iconNames.push('image-missing');

        const fallbackGIcon = _getAppInfoGIcon(iconName, id, title);

        let menuProxy = null;
        const menuPath = safeUnpack(proxy.get_cached_property('Menu'));
        if (menuPath && menuPath !== '/') {
            try {
                menuProxy = new Gio.DBusProxy({
                    g_connection: this._dbus, g_interface_name: 'com.canonical.dbusmenu',
                    g_interface_info: Gio.DBusInterfaceInfo.new_for_xml(MENU_XML),
                    g_name: bus, g_object_path: menuPath
                });
                await menuProxy.init_async(GLib.PRIORITY_DEFAULT, null);
            } catch(e) {
                menuProxy = null;
            }
        }

        const itemData = {
            service, proxy, menuProxy,
            absoluteIconPath,
            pixbuf,
            iconNames,
            title: title || id,
            fallbackGIcon,
            itemIsMenu: !!itemIsMenu,
            
            activate: (x, y) => {
                const variant = new GLib.Variant('(ii)', [x, y]);
                try {
                    proxy.call('Activate', variant, Gio.DBusCallFlags.NONE, -1, null, (p, res) => {
                        try { p.call_finish(res); } catch(e) {
                            proxy.call('SecondaryActivate', variant, Gio.DBusCallFlags.NONE, -1, null, (p2, r2) => {
                                try { p2.call_finish(r2); } catch(e2){ proxy.call('ContextMenu', variant, Gio.DBusCallFlags.NONE, -1, null, () => {}); }
                            });
                        }
                    });
                } catch(e) {}
            },
            contextMenu: (x, y) => {
                const variant = new GLib.Variant('(ii)', [x, y]);
                try {
                    proxy.call('ContextMenu', variant, Gio.DBusCallFlags.NONE, -1, null, (p, res) => {
                        try { p.call_finish(res); } catch(e){ }
                    });
                } catch(e) { }
            },
            secondaryActivate: (x, y) => {
                const variant = new GLib.Variant('(ii)', [x, y]);
                try {
                    proxy.call('SecondaryActivate', variant, Gio.DBusCallFlags.NONE, -1, null, (p, res) => {
                        try { p.call_finish(res); } catch(e){ }
                    });
                } catch(e) { }
            },
            scroll: (delta, orientation) => {
                const variant = new GLib.Variant('(is)', [delta, orientation]);
                try {
                    proxy.call('Scroll', variant, Gio.DBusCallFlags.NONE, -1, null, () => {});
                } catch(e) { }
            }
        };

        return itemData;
    }

    destroy() {
        for (const service of this._items.keys()) this._clearRefreshTimeouts(service);
        
        for (const [service, sigs] of this._rawSignals.entries()) {
             const item = this._items.get(service);
             if (item && item.proxy) {
                 try { item.proxy.disconnect(sigs.propSignalId); } catch(e){}
                 try { item.proxy.disconnect(sigs.ownerChangedId); } catch(e){}
             }
             try { this._dbus.signal_unsubscribe(sigs.sigId1); } catch(e){}
             try { this._dbus.signal_unsubscribe(sigs.sigId2); } catch(e){}
        }
        
        for (const timeoutId of this._unregisterTimeouts.values()) {
            GLib.source_remove(timeoutId);
        }

        this._rawSignals.clear();
        this._unregisterTimeouts.clear();

        if (this._ownNameId) Gio.bus_unown_name(this._ownNameId);
        if (this._regId) this._dbus.unregister_object(this._regId);
        this._watcherProxy = null;
        this._items.clear();
    }
});