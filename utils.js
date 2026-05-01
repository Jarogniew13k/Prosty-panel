// Prosty Panel — utils.js (Wersja wydawnicza, ignorowanie zniszczonych BoxPointer)

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { PANEL_HEIGHT, PANEL_GAP, PANEL_RIGHT_MARGIN } from './constants.js';

export function makeSep() {
    return new St.Widget({ style_class: 'tb-sep', y_align: Clutter.ActorAlign.CENTER, y_expand: false, x_expand: false });
}

export function makeIconBtn(iconName, styleClass = 'tb-btn') {
    return new St.Button({
        style_class: styleClass, reactive: true, can_focus: true, x_expand: false, y_expand: false,
        y_align: Clutter.ActorAlign.CENTER,
        child: new St.Icon({ icon_name: iconName, icon_size: 16, style_class: 'tb-btn-icon' })
    });
}

export function openMenuAboveBar(menu, sourceButton, gap = PANEL_GAP, rightAnchor = null, centerOnSource = false, pointerX = null) {
    if (!menu) return;
    if (menu.isOpen) { menu.close(); return; }

    const origSource = menu.sourceActor;
    menu.sourceActor = sourceButton;
    const bp = menu._boxPointer;
    let origBpSource = null; let origReposition = null; let heightCapId = 0;
    const mon = Main.layoutManager.primaryMonitor;
    const bar = _getBarFor(sourceButton);
    const isFloating = bar && bar.has_style_class_name('mode-floating');
    const FLOAT_MARGIN = 8; 

    let barTop = isFloating ? (mon.y + mon.height - PANEL_HEIGHT - FLOAT_MARGIN) : (mon.y + mon.height - PANEL_HEIGHT);

    if (bp) {
        bp._userArrowSide = St.Side.BOTTOM; bp._arrowSide = St.Side.BOTTOM;
        bp.set_style('-arrow-rise:0;-arrow-base:0;-arrow-border-width:0;-boxpointer-gap:0');
        if ('sourceActor' in bp) { origBpSource = bp.sourceActor; bp.sourceActor = sourceButton; }
        else if ('_sourceActor' in bp) { origBpSource = bp._sourceActor; bp._sourceActor = sourceButton; }
        if (bp._container) {
            heightCapId = bp._container.connect('get-preferred-height', (_actor, _forWidth, alloc) => {
                if (alloc.natural_size > mon.height - PANEL_HEIGHT - gap) alloc.natural_size = mon.height - PANEL_HEIGHT - gap;
            });
        }
        origReposition = bp._reposition;
        bp._reposition = function(allocationBox) {
            origReposition.call(this, allocationBox);
            const w = allocationBox.get_width(); const h = allocationBox.get_height();
            let stageX;
            if (pointerX !== null) stageX = pointerX - (w / 2);
            else if (centerOnSource && sourceButton) {
                const [bx] = sourceButton.get_transformed_position();
                stageX = bx + (sourceButton.width / 2) - (w / 2);
            } else if (rightAnchor) {
                const [ax] = rightAnchor.get_transformed_position(); stageX = ax - w - 4;
            } else {
                stageX = isFloating ? (mon.x + mon.width - FLOAT_MARGIN - w - PANEL_RIGHT_MARGIN) : (mon.x + mon.width - w - PANEL_RIGHT_MARGIN);
            }
            const minX = mon.x + 4; const maxX = mon.x + mon.width - w - 4;
            if (stageX < minX) stageX = minX; if (stageX > maxX) stageX = maxX;
            const stageY = barTop - h - gap;
            let parent = this.get_parent(); let success = false; let x = stageX, y = stageY;
            while (parent && !success) { [success, x, y] = parent.transform_stage_point(stageX, stageY); parent = parent.get_parent(); }
            allocationBox.set_origin(Math.floor(x), Math.floor(y));
        };
        if (bp.queue_relayout) bp.queue_relayout();
    }

    menu._arrowSide = St.Side.BOTTOM; menu._arrowAlignment = 0.5;
    const POPUP_ANIM_FADE = 2; const origMenuOpen = menu.open; const origMenuClose = menu.close;
    menu.open = function(a) { return origMenuOpen.call(this, POPUP_ANIM_FADE); };
    menu.close = function(a) { return origMenuClose.call(this, POPUP_ANIM_FADE); };
    menu.open();
    
    if (bar) { bar._openMenus.add(menu); try { bar.emit('menu-opened'); } catch (e) {} }

    let isClosed = false;

    const cleanupMenu = () => {
        if (isClosed) return;
        isClosed = true;
        try { menu.sourceActor = origSource; menu.open = origMenuOpen; menu.close = origMenuClose; } catch(e) {}
        
        if (bp) {
            // 🟢 FIX: Przechwytywanie błędu operacji na zniszczonym "ogonie" (BoxPointer) menu
            try {
                if (heightCapId && bp._container) { bp._container.disconnect(heightCapId); heightCapId = 0; }
                if (origBpSource !== null) { if ('sourceActor' in bp) bp.sourceActor = origBpSource; else if ('_sourceActor' in bp) bp._sourceActor = origBpSource; }
                if (origReposition) { bp._reposition = origReposition; origReposition = null; }
                bp.set_style(null);
            } catch(e) {} 
        }
        
        if (bar && bar._openMenus && bar._openMenus.has(menu)) {
            bar._openMenus.delete(menu);
            try { bar.emit('menu-closed'); } catch (e) {}
        }
    };

    const closedId = menu.connect('menu-closed', () => {
        try { menu.disconnect(closedId); } catch(e){}
        cleanupMenu();
    });

    menu.connect('destroy', () => {
        cleanupMenu();
    });
}

function _getBarFor(sourceActor) {
    let p = sourceActor;
    while (p) { if (p.has_style_class_name && p.has_style_class_name('bottom-taskbar')) return p; p = p.get_parent ? p.get_parent() : null; }
    return null;
}
