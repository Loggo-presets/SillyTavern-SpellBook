import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const MODULE_NAME = 'third-party/SillyTavern-SpellBook';

const defaultSettings = {
    categories: [
        {
            id: 'default-cat',
            name: 'Spell Book',
            entries: [
                {
                    id: 'default-entry',
                    name: 'Welcome',
                    pages: [
                        { content: '# Welcome to Spell Book! 📖\n\nYour own floating spell book for SillyTavern RPs / or fancy notepad.\n\n## Getting Started\n\n- **Switch categories** via the dropdown in the header\n- **Double-click** content to edit, or use the pencil button\n- **Drag entries** in the sidebar to reorder them\n- Access **settings** via the gear icon' },
                        { content: '# Features ✨\n\n- **Multi-category** organization\n- **Page pagination** for long entries\n- **Custom backgrounds** per category/entry\n- **Page animations** (Flip, Fade, Slide)\n- **Keyboard shortcuts** for quick access\n- **Pop-out windows** for multiple categories\n- **Per-window locking** to prevent accidental moves\n- **Full Markdown** support' }
                    ]
                }
            ],
            windowState: {
                isOpen: false,
                top: '100px',
                left: '100px',
                width: '650px',
                height: '550px',
                activeEntryId: 'default-entry',
                activePageIndex: 0,
                isFullscreen: false
            },
            icon: 'fa-hat-wizard'
        }
    ],
    bookModeEnabled: true,
    opacity: 0.1,
    lockLayout: false,
    fontScale: 1.3,
    defaultCategoryId: null,
    themeColor: null,
    isEnabled: true,
    alwaysOnTop: true,
    pageFlipAnimation: true,
    pageFlipSpeed: 0.2,
    pageFlipStyle: 'flip',
    autoPaginate: true,
    paginateLimit: 3000
};

let converter = null;

function getConverter() {
    if (!converter && window.showdown) {
        converter = new window.showdown.Converter({
            emoji: true,
            tables: true,
            strikethrough: true,
            tasklists: true,
        });
    }
    return converter;
}


function autoPaginateEntry(entry, limit) {
    if (!entry.pages || entry.pages.length === 0) return false;

    // 1. Combine all content from all pages
    const fullContent = entry.pages.map(p => p.content).join('\n\n');

    // 2. If it fits in one page and we already have one page, nothing to do
    if (fullContent.length <= limit && entry.pages.length <= 1) return false;

    // 3. Redistribute content
    const newPages = [];
    let remaining = fullContent;

    while (remaining.length > limit) {
        // Try to find a split at a paragraph/newline
        let splitIdx = remaining.lastIndexOf('\n', limit);

        // If no newline or it's too far back, force split
        if (splitIdx === -1 || splitIdx < limit * 0.7) {
            splitIdx = limit;
        }

        newPages.push({ content: remaining.substring(0, splitIdx).trim() });
        remaining = remaining.substring(splitIdx).trim();
    }

    if (remaining.length > 0) {
        newPages.push({ content: remaining });
    }

    // 4. Update entry pages
    entry.pages = newPages;
    return true;
}

function applyAutoPaginationToOpenWindows() {
    const settings = extension_settings[MODULE_NAME];
    const limit = settings.paginateLimit || 2000;

    $('.sb-container').each(function () {
        const windowEl = $(this);
        const catId = windowEl.attr('data-id');
        const cat = getCategoryById(catId);
        if (!cat) return;

        const entry = getActiveEntry(cat);
        if (entry && settings.autoPaginate) {
            const changed = autoPaginateEntry(entry, limit);
            if (changed) {
                // Ensure active index is valid
                if (cat.windowState.activePageIndex >= entry.pages.length) {
                    cat.windowState.activePageIndex = 0;
                }
                renderFullUI(windowEl, cat);
            }
        }
    });
}

function loadSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }

    const setts = extension_settings[MODULE_NAME];

    // Apply defaults
    for (const key in defaultSettings) {
        if (setts[key] === undefined) {
            setts[key] = JSON.parse(JSON.stringify(defaultSettings[key]));
        }
    }

    // 1. Migration from 2-level (categories -> pages) to 3-level (categories -> entries -> pages)
    if (setts.categories && setts.categories.length > 0 && setts.categories[0].pages) {
        setts.categories.forEach(cat => {
            if (cat.pages) {
                cat.entries = cat.pages.map(p => ({
                    id: p.id,
                    name: p.name,
                    pages: [{ content: p.content }]
                }));
                delete cat.pages;
            }
        });
        setts.activeEntryId = setts.activePageId;
        setts.activePageIndex = 0;
        setts.bookModeEnabled = true;
        delete setts.activePageId;
    }

    // 2. Migration from old format (original pages array)
    if (setts.pages && !setts.categories) {
        const oldPages = setts.pages;
        setts.categories = [{
            id: 'migrated-cat',
            name: 'Spells',
            entries: oldPages.map(p => ({
                id: p.id,
                name: p.name,
                pages: [{ content: p.content }]
            }))
        }];
        setts.activeCategoryId = 'migrated-cat';
        setts.activeEntryId = setts.categories[0].entries[0]?.id;
        setts.activePageIndex = 0;
        setts.bookModeEnabled = true;
        delete setts.pages;
    }

    // 3. Migration to Multi-Window (moving global state to category objects)
    if (setts.categories && (setts.activeCategoryId || setts.isOpen !== undefined)) {
        setts.categories.forEach(cat => {
            if (!cat.windowState) {
                cat.windowState = {
                    isOpen: (cat.id === setts.activeCategoryId && setts.isOpen) || false,
                    top: setts.top || '100px',
                    left: setts.left || '100px',
                    width: setts.width || '650px',
                    height: setts.height || '550px',
                    activeEntryId: (cat.id === setts.activeCategoryId ? setts.activeEntryId : cat.entries[0]?.id) || null,
                    activePageIndex: (cat.id === setts.activeCategoryId ? setts.activePageIndex : 0) || 0,
                    isFullscreen: false
                };
            }
        });
        // Clean up global state
        delete setts.activeCategoryId;
        delete setts.activeEntryId;
        delete setts.activePageIndex;
        delete setts.isOpen;
        delete setts.top;
        delete setts.left;
        delete setts.width;
        delete setts.height;
    }

    for (const key in defaultSettings) {
        if (setts[key] === undefined) {
            setts[key] = JSON.parse(JSON.stringify(defaultSettings[key]));
        }
    }

    // Ensure all categories have windowState and icon
    setts.categories.forEach(cat => {
        if (!cat.windowState) {
            cat.windowState = JSON.parse(JSON.stringify(defaultSettings.categories[0].windowState));
            cat.windowState.activeEntryId = cat.entries[0]?.id || null;
            cat.windowState.isOpen = false;
        }
        if (!cat.icon) {
            cat.icon = 'fa-hat-wizard';
        }
    });

    if (setts.lockLayout === undefined) setts.lockLayout = false;
    if (setts.fontScale === undefined) setts.fontScale = 1.0;

    applyStyles();
}

function applyStyles() {
    const settings = extension_settings[MODULE_NAME];
    const opacity = settings.opacity !== undefined ? settings.opacity : 0.85;
    const fontScale = settings.fontScale || 1.0;
    const scalePercent = Math.round(fontScale * 100);

    const root = document.documentElement;
    root.style.setProperty('--sb-opacity', opacity);
    root.style.setProperty('--sb-font-scale', fontScale);
    root.style.setProperty('--sb-flip-speed', (settings.pageFlipSpeed || 0.4) + 's');

    // Font Size (backward compat or legacy if any)
    const baseSize = 0.9;
    root.style.setProperty('--sb-font-size', `${baseSize * fontScale}rem`);

    // Theme Override
    if (settings.themeColor && settings.themeColor !== '#000000') {
        root.style.setProperty('--sb-accent', settings.themeColor);
        root.style.setProperty('--sb-accent-hover', settings.themeColor);
    } else {
        root.style.removeProperty('--sb-accent');
        root.style.removeProperty('--sb-accent-hover');
    }

    // Update UI numbers if settings page is open
    $('#sb-opacity-value').text(`${Math.round(opacity * 100)}%`);
    $('#sb-font-scale-value').text(`${scalePercent}%`);

    if (settings.lockLayout) {
        $('.sb-container').addClass('sb-locked');
    } else {
        $('.sb-container').removeClass('sb-locked');
    }
}

function resetSettings() {
    Object.assign(extension_settings[MODULE_NAME], JSON.parse(JSON.stringify(defaultSettings)));
    $('.sb-container').remove();
    init();
    saveSettingsDebounced();
}

function exportData() {
    const settings = extension_settings[MODULE_NAME];
    const data = {
        version: 2,
        exportDate: new Date().toISOString(),
        categories: settings.categories
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spell-book-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (data.categories && Array.isArray(data.categories)) {
                    extension_settings[MODULE_NAME].categories = data.categories;
                    $('.sb-container').remove();
                    init();
                    saveSettingsDebounced();
                    toastr.success(`Imported ${data.categories.length} category(s)`);
                } else if (data.pages && Array.isArray(data.pages)) {
                    // Legacy format
                    extension_settings[MODULE_NAME].categories = [{
                        id: 'imported',
                        name: 'Imported',
                        entries: [{ id: 'imp-entry', name: 'Imported Entry', pages: data.pages }],
                        windowState: JSON.parse(JSON.stringify(defaultSettings.categories[0].windowState))
                    }];
                    $('.sb-container').remove();
                    init();
                    saveSettingsDebounced();
                    toastr.success(`Imported ${data.pages.length} page(s)`);
                } else {
                    toastr.error('Invalid backup file format.');
                }
            } catch (err) {
                toastr.error('Error reading backup: ' + err.message);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function getCategoryById(id) {
    const settings = extension_settings[MODULE_NAME];
    return settings.categories.find(c => c.id === id);
}

function getActiveEntry(category) {
    if (!category || !category.entries) return null;
    const activeId = category.windowState.activeEntryId;
    return category.entries.find(e => e.id === activeId) || category.entries[0];
}

function getActivePage(category) {
    const entry = getActiveEntry(category);
    if (!entry || !entry.pages) return null;
    const index = category.windowState.activePageIndex || 0;
    return entry.pages[index] || entry.pages[0];
}

async function updateContentUI(windowEl, category) {
    const entry = getActiveEntry(category);
    const page = getActivePage(category);
    const settings = extension_settings[MODULE_NAME];
    const content = windowEl.find('.sb-content');

    const md = page ? page.content : '';
    const conv = getConverter();
    const html = conv ? conv.makeHtml(md) : md.replace(/\n/g, '<br>');

    content.html(html);

    // Pagination Footer
    windowEl.find('.sb-pagination').remove();
    if (settings.bookModeEnabled && entry) {
        const pageCount = (entry.pages || []).length;
        const currentIndex = category.windowState.activePageIndex || 0;

        const footer = $(`
            <div class="sb-pagination">
                <div class="sb-pagination-nav">
                    <i class="fa-solid fa-chevron-left sb-page-prev ${currentIndex === 0 ? 'disabled' : ''}" title="Previous Page"></i>
                    <span>${currentIndex + 1} / ${pageCount}</span>
                    <i class="fa-solid fa-chevron-right sb-page-next ${currentIndex === pageCount - 1 ? 'disabled' : ''}" title="Next Page"></i>
                </div>
                <div class="sb-pagination-actions">
                    <i class="fa-solid fa-plus sb-page-add" title="Add Page to Entry"></i>
                    <i class="fa-solid fa-trash sb-page-del" title="Delete current page"></i>
                </div>
            </div>
        `);

        footer.find('.sb-page-prev').on('click', () => {
            if (currentIndex > 0) {
                category.windowState.activePageIndex--;
                renderFullUI(windowEl, category);
                saveSettingsDebounced();
                if (settings.pageFlipAnimation) {
                    requestAnimationFrame(() => {
                        const content = windowEl.find('.sb-content');
                        const style = settings.pageFlipStyle || 'flip';
                        const animClass = `page-${style}-left`;
                        content.addClass(animClass);
                        content.one('animationend', () => content.removeClass(animClass));
                    });
                }
            }
        });

        footer.find('.sb-page-next').on('click', () => {
            if (currentIndex < pageCount - 1) {
                category.windowState.activePageIndex++;
                renderFullUI(windowEl, category);
                saveSettingsDebounced();
                if (settings.pageFlipAnimation) {
                    requestAnimationFrame(() => {
                        const content = windowEl.find('.sb-content');
                        const style = settings.pageFlipStyle || 'flip';
                        const animClass = `page-${style}-right`;
                        content.addClass(animClass);
                        content.one('animationend', () => content.removeClass(animClass));
                    });
                }
            }
        });

        footer.find('.sb-page-add').on('click', () => {
            if (!entry.pages) entry.pages = [];
            entry.pages.push({ content: '# New Page\n\n...' });
            category.windowState.activePageIndex = entry.pages.length - 1;
            renderFullUI(windowEl, category);
            saveSettingsDebounced();
            toastr.info('Page added to entry');
        });

        footer.find('.sb-page-del').on('click', () => {
            if (entry.pages.length <= 1) {
                toastr.warning('Cannot delete the last page of an entry.');
                return;
            }
            entry.pages.splice(currentIndex, 1);
            category.windowState.activePageIndex = Math.max(0, currentIndex - 1);
            renderFullUI(windowEl, category);
            saveSettingsDebounced();
            toastr.info('Page removed');
        });

        windowEl.find('.sb-content-wrapper').append(footer);
    }
}

function renderSidebar(windowEl, category) {
    const settings = extension_settings[MODULE_NAME];

    // Update category name in header
    windowEl.find('.sb-category-name').text(category?.name || 'Untitled');

    // Render entries
    const entryList = windowEl.find('.sb-page-list');
    entryList.empty();

    if (!category || !category.entries) return;

    category.entries.forEach((entry, index) => {
        const isActive = entry.id === category.windowState.activeEntryId;
        const iconHtml = entry.icon ? `<i class="fa-solid ${entry.icon} sb-entry-icon"></i>` : '';
        const li = $(`
            <li class="sb-page-item ${isActive ? 'active' : ''}" data-id="${entry.id}" draggable="true">
                ${iconHtml}
                <span class="sb-page-name" title="${entry.name}">${entry.name}</span>
                <div class="sb-page-actions">
                    <i class="fa-solid fa-right-left sb-page-move" title="Move to Category"></i>
                    <i class="fa-solid fa-image sb-entry-bg" title="Set Background"></i>
                    <i class="fa-solid fa-pen sb-edit-page-btn" title="Rename"></i>
                    <i class="fa-solid fa-trash sb-delete-page-btn" title="Delete"></i>
                </div>
            </li>
        `);

        // Drag & Drop
        li.on('dragstart', (e) => {
            e.originalEvent.dataTransfer.setData('text/plain', index);
            e.originalEvent.dataTransfer.effectAllowed = 'move';
            li.addClass('dragging');
        });
        li.on('dragover', (e) => {
            e.preventDefault();
            e.originalEvent.dataTransfer.dropEffect = 'move';
            li.addClass('drag-over');
        });
        li.on('dragleave', () => li.removeClass('drag-over'));
        li.on('dragend', () => {
            li.removeClass('dragging drag-over');
            $('.sb-page-item').removeClass('drag-over');
        });
        li.on('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const fromIndex = parseInt(e.originalEvent.dataTransfer.getData('text/plain'));
            const toIndex = index;
            if (fromIndex !== toIndex && !isNaN(fromIndex)) {
                const [moved] = category.entries.splice(fromIndex, 1);
                category.entries.splice(toIndex, 0, moved);
                renderSidebar(windowEl, category);
                saveSettingsDebounced();
            }
        });

        // Click (Select)
        li.on('click', () => {
            category.windowState.activeEntryId = entry.id;
            category.windowState.activePageIndex = 0;
            renderFullUI(windowEl, category); // Full render to update background
            saveSettingsDebounced();
        });

        // Move to Category
        li.find('.sb-page-move').on('click', async (e) => {
            e.stopPropagation();
            const targetId = await showCategorySelectModal(category.id);
            if (!targetId) return;

            let targetCat;
            if (targetId === 'new') {
                const newName = await showInputModal('New Category Name:', 'New Category');
                if (!newName) return;
                const newId = Date.now().toString();
                targetCat = {
                    id: newId,
                    name: newName,
                    icon: 'fa-hat-wizard',
                    entries: [],
                    windowState: JSON.parse(JSON.stringify(settings.categories[0].windowState))
                };
                targetCat.windowState.isOpen = false;
                settings.categories.push(targetCat);
            } else {
                targetCat = settings.categories.find(c => c.id === targetId);
            }

            if (targetCat) {
                // Remove from current
                category.entries = category.entries.filter(en => en.id !== entry.id);
                if (category.windowState.activeEntryId === entry.id) {
                    category.windowState.activeEntryId = category.entries[0]?.id || null;
                }

                // Add to target
                targetCat.entries.push(entry);

                toastr.success(`Moved "${entry.name}" to ${targetCat.name}`);
                renderSidebar(windowEl, category);
                saveSettingsDebounced();
            }
        });

        // Background
        li.find('.sb-entry-bg').on('click', async (e) => {
            e.stopPropagation();
            const result = await showBackgroundModal(entry.background, entry.backgroundPos, entry.backgroundBlur);
            if (result) {
                entry.background = result.url;
                entry.backgroundPos = result.pos;
                entry.backgroundBlur = result.blur;
                renderFullUI(windowEl, category); // Need full render to update BG
                saveSettingsDebounced();
            }
        });

        // Rename
        li.find('.sb-edit-page-btn').on('click', (e) => {
            e.stopPropagation();
            const nameSpan = li.find('.sb-page-name');
            const currentName = entry.name;
            const input = $(`<input type="text" class="sb-inline-input" value="${currentName}">`);
            li.off('click'); // Disable selection while editing
            nameSpan.replaceWith(input);
            input.focus().select();

            const finishRename = () => {
                const newName = input.val().trim() || currentName;
                entry.name = newName;
                renderFullUI(windowEl, category);
                saveSettingsDebounced();
            };

            input.on('blur', finishRename);
            input.on('keydown', (e) => {
                if (e.key === 'Enter') finishRename();
                if (e.key === 'Escape') { input.val(currentName); finishRename(); }
            });
        });

        // Delete Entry
        li.find('.sb-delete-page-btn').on('click', async (e) => {
            e.stopPropagation();
            if (await showConfirmModal(`Delete "${entry.name}"?`)) {
                category.entries = category.entries.filter(en => en.id !== entry.id);
                if (category.windowState.activeEntryId === entry.id) {
                    category.windowState.activeEntryId = category.entries[0]?.id || null;
                    category.windowState.activePageIndex = 0;
                }
                renderSidebar(windowEl, category);
                updateContentUI(windowEl, category);
                saveSettingsDebounced();
                toastr.info('Entry deleted');
            }
        });

        entryList.append(li);
    });
}

function renderFullUI(windowEl, category) {
    if (!windowEl || !category) return;

    // Header Sync
    windowEl.find('.sb-title-text').text(category.name);
    windowEl.find('.sb-icon-main').attr('class', `fa-solid ${category.icon || 'fa-hat-wizard'} sb-icon-main`);

    // Sidebar Header Sync
    windowEl.find('.sb-category-name').text(category.name);

    // Background Application (Cascading: Entry > Category > None)
    const activeEntry = getActiveEntry(category);
    let bgUrl = activeEntry?.background || category.background;
    let bgPos = activeEntry?.backgroundPos || category.backgroundPos || '50% 50%';

    const bgLayer = windowEl.find('.sb-background-layer');
    if (bgUrl) {
        bgLayer.css({
            'background-image': `url("${bgUrl}")`,
            'background-position': bgPos,
            '--sb-blur': `${activeEntry?.backgroundBlur ?? category.backgroundBlur ?? 15}px`
        });
        windowEl.addClass('sb-bg-active');
    } else {
        bgLayer.css('background-image', 'none');
        windowEl.removeClass('sb-bg-active');
    }

    renderSidebar(windowEl, category);
    updateContentUI(windowEl, category);
}

function toggleEditMode(windowEl, category, enable) {
    const editorContainer = windowEl.find('.sb-editor-container');
    const editor = windowEl.find('.sb-editor');
    const content = windowEl.find('.sb-content');
    const pagination = windowEl.find('.sb-pagination');
    const page = getActivePage(category);

    if (enable && page) {
        editor.val(page.content);
        editorContainer.css('display', 'flex');
        content.hide();
        pagination.hide();
        editor.focus();
    } else {
        editorContainer.hide();
        content.show();
        pagination.show();
    }
}



const ICON_PRESETS = [
    // Magic & Spells
    'fa-hat-wizard', 'fa-wand-magic-sparkles', 'fa-scroll', 'fa-book-skull', 'fa-flask', 'fa-fire', 'fa-bolt', 'fa-cloud-bolt', 'fa-star',
    // Combat & Weapons
    'fa-gavel', 'fa-shield-halved', 'fa-skull', 'fa-hammer', 'fa-bullseye', 'fa-fist-raised', 'fa-dungeon', 'fa-dragon',
    // Utility & Misc
    'fa-pen-nib', 'fa-gear', 'fa-user', 'fa-box-open', 'fa-map', 'fa-gem', 'fa-crown', 'fa-heart',
    'fa-feather', 'fa-eye', 'fa-key', 'fa-lock', 'fa-unlock', 'fa-hourglass', 'fa-dice-d20', 'fa-ghost', 'fa-spider'
];

function showIconModal(category, windowEl) {
    return new Promise((resolve) => {
        const currentIcon = category.icon || 'fa-hat-wizard';
        const modalHtml = `
            <div id="sb-modal-overlay">
                <div class="sb-modal" style="width: 500px;">
                    <h3>Select Icon</h3>
                    <div class="sb-icon-grid">
                        ${ICON_PRESETS.map(icon => `
                            <div class="sb-icon-option ${icon === currentIcon ? 'active' : ''}" data-icon="${icon}">
                                <i class="fa-solid ${icon}"></i>
                            </div>
                        `).join('')}
                    </div>
                    <div class="sb-modal-footer">
                        <button class="sb-modal-btn cancel">Cancel</button>
                    </div>
                </div>
            </div>
        `;
        const modal = $(modalHtml);
        $('body').append(modal);

        const close = (val) => {
            modal.remove();
            resolve(val);
        };

        modal.find('.cancel').on('click', () => close(null));
        modal.on('click', (e) => {
            if ($(e.target).is('#sb-modal-overlay')) close(null);
        });

        modal.find('.sb-icon-option').on('click', function () {
            const newIcon = $(this).data('icon');
            category.icon = newIcon;

            // Update UI immediately
            if (windowEl) {
                windowEl.find('.sb-icon-main').attr('class', `fa-solid ${newIcon} sb-icon-main`);
            }

            // Update all other windows for this category
            $(`.sb-container[data-id="${category.id}"]`).each(function () {
                $(this).find('.sb-icon-main').attr('class', `fa-solid ${newIcon} sb-icon-main`);
                $(this).find(`.sb-cat-icon-display`).attr('class', `fa-solid ${newIcon} sb-cat-icon-display`);
            });

            saveSettingsDebounced();
            close(newIcon);
        });
    });
}

function showBackgroundModal(currentUrl, currentPos, currentBlur) {
    return new Promise((resolve) => {
        const overlay = $(`<div id="sb-modal-overlay"></div>`);
        const initialBlur = currentBlur ?? 15;
        const modal = $(`
            <div class="sb-modal" style="width: 450px;">
                <h3>Set Background Image</h3>
                <div style="display: flex; gap: 8px;">
                    <input type="text" class="sb-modal-input" placeholder="Image URL (recommended)" value="${currentUrl || ''}">
                    <label class="menu_button" style="width: 40px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
                        <i class="fa-solid fa-upload"></i>
                        <input type="file" accept="image/*" style="display: none;">
                    </label>
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 15px; margin: 5px 0;">
                    <div style="text-align: center;">
                        <div style="font-size: 0.85rem; opacity: 0.8; margin-bottom: 8px;">Framing / Focus Point</div>
                        <div class="sb-framing-grid">
                            ${['0% 0%', '50% 0%', '100% 0%', '0% 50%', '50% 50%', '100% 50%', '0% 100%', '50% 100%', '100% 100%'].map(pos =>
            `<div class="sb-frame-option ${pos === (currentPos || '50% 50%') ? 'active' : ''}" data-pos="${pos}"><div class="sb-frame-dot"></div></div>`
        ).join('')}
                        </div>
                    </div>

                    <div class="sb-blur-control">
                        <div class="sb-blur-header">
                            <span>Background Blur</span>
                            <span class="sb-blur-value">${initialBlur}px</span>
                        </div>
                        <input type="range" class="sb-blur-slider" min="0" max="40" value="${initialBlur}">
                    </div>
                </div>

                <div class="sb-modal-footer">
                    <button class="sb-modal-btn cancel" data-action="clear" style="margin-right: auto; color: #ff5555;">Clear BG</button>
                    <button class="sb-modal-btn cancel" data-action="cancel">Cancel</button>
                    <button class="sb-modal-btn confirm">Save</button>
                </div>
            </div>
        `);

        overlay.append(modal);
        $('body').append(overlay);
        const input = modal.find('input[type="text"]');
        input.focus();

        // File Upload
        modal.find('input[type="file"]').on('change', function (e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                input.val(ev.target.result); // Set Base64 to input
                toastr.info('Image loaded. Click Save to apply.');
            };
            if (file.size > 2 * 1024 * 1024) {
                toastr.warning('Large images may slow down load times. URLs are recommended.');
            }
            reader.readAsDataURL(file);
        });

        // Framing Grid
        let selectedPos = currentPos || '50% 50%';
        modal.find('.sb-frame-option').on('click', function () {
            modal.find('.sb-frame-option').removeClass('active');
            $(this).addClass('active');
            selectedPos = $(this).data('pos');
        });

        // Blur Slider
        let selectedBlur = initialBlur;
        modal.find('.sb-blur-slider').on('input', function () {
            selectedBlur = parseInt($(this).val());
            modal.find('.sb-blur-value').text(`${selectedBlur}px`);
        });

        modal.find('.confirm').on('click', () => {
            modal.remove();
            overlay.remove();
            resolve({ url: input.val(), pos: selectedPos, blur: selectedBlur });
        });

        modal.find('[data-action="cancel"]').on('click', () => {
            modal.remove();
            overlay.remove();
            resolve(null);
        });

        modal.find('[data-action="clear"]').on('click', () => {
            modal.remove();
            overlay.remove();
            resolve({ url: '', pos: '50% 50%' });
        });

        overlay.on('click', (e) => {
            if (e.target.id === 'sb-modal-overlay') {
                modal.remove();
                overlay.remove();
                resolve(null);
            }
        });
    });
}

function showCategorySelectModal(currentCatId) {
    const settings = extension_settings[MODULE_NAME];
    return new Promise((resolve) => {
        const overlay = $(`<div id="sb-modal-overlay"></div>`);
        const modal = $(`
            <div class="sb-modal" style="width: 400px;">
                <h3>Move Entry to...</h3>
                <div class="sb-modal-body" style="display: flex; flex-direction: column; gap: 8px;">
                    ${settings.categories.map(cat =>
            cat.id !== currentCatId ?
                `<button class="sb-modal-btn" style="text-align: left; justify-content: flex-start;" data-id="${cat.id}">
                            <i class="fa-solid ${cat.icon || 'fa-hat-wizard'}" style="margin-right: 8px;"></i> ${cat.name}
                        </button>` : ''
        ).join('')}
                    <button class="sb-modal-btn" style="text-align: left; justify-content: flex-start; color: var(--sb-accent);" data-id="new">
                        <i class="fa-solid fa-plus" style="margin-right: 8px;"></i> Create New Category
                    </button>
                </div>
                <div class="sb-modal-footer">
                    <button class="sb-modal-btn cancel">Cancel</button>
                </div>
            </div>
        `);

        overlay.append(modal);
        $('body').append(overlay);

        modal.find('button[data-id]').on('click', function () {
            const id = $(this).data('id');
            modal.remove();
            overlay.remove();
            resolve(id);
        });

        const close = () => { modal.remove(); overlay.remove(); resolve(null); };
        modal.find('.cancel').on('click', close);
        overlay.on('click', (e) => { if (e.target.id === 'sb-modal-overlay') close(); });
    });
}

function showSettingsModal() {
    const settings = extension_settings[MODULE_NAME];
    return new Promise((resolve) => {
        const overlay = $(`<div id="sb-modal-overlay"></div>`);
        const modal = $(`
            <div class="sb-modal" style="width: 500px; max-width: 90vw;">
                <h3 style="border-bottom: 1px solid var(--sb-glass-border); padding-bottom: 10px; margin-bottom: 15px;">Spell Book Settings</h3>
                
                <div style="margin-bottom: 15px;">
                    <label style="display:block; margin-bottom: 5px; font-weight:600;">Font Size: <span id="sb-modal-font-val">${Math.round((settings.fontScale || 1.0) * 100)}%</span></label>
                    <input type="range" id="sb-modal-font-scale" min="0.7" max="1.3" step="0.05" value="${settings.fontScale || 1.0}" style="width: 100%;">
                </div>

                <div style="margin-bottom: 15px; display: flex; align-items: center; justify-content: space-between;">
                    <label style="font-weight:600;">Theme Color Override</label>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <input type="color" id="sb-modal-theme-color" value="${settings.themeColor || '#000000'}">
                        <small class="menu_button" id="sb-modal-theme-reset">Reset</small>
                    </div>
                </div>

                <div style="margin-bottom: 15px;">
                    <label style="display:block; margin-bottom: 5px; font-weight:600;">Default Category</label>
                    <select id="sb-modal-default-cat" class="text_pole" style="width: 100%;">
                        <option value="">None (First Available)</option>
                        ${settings.categories.map(cat => `<option value="${cat.id}" ${cat.id === settings.defaultCategoryId ? 'selected' : ''}>${cat.name}</option>`).join('')}
                    </select>
                </div>

                <div style="margin-bottom: 15px;">
                    <label style="display:block; margin-bottom: 5px; font-weight:600;">Window Transparency: <span id="sb-modal-opacity-val">${Math.round((settings.opacity || 0.85) * 100)}%</span></label>
                    <input type="range" id="sb-modal-opacity" min="0.1" max="1.0" step="0.05" value="${settings.opacity || 0.85}" style="width: 100%;">
                </div>

                <div style="margin-bottom: 15px; display: flex; align-items: center; justify-content: space-between;">
                   <label style="font-weight:600;">Always On Top</label>
                   <input type="checkbox" id="sb-modal-always-top" ${settings.alwaysOnTop ? 'checked' : ''}>
                </div>

                <div style="margin-bottom: 15px; display: flex; align-items: center; justify-content: space-between;">
                   <label style="font-weight:600;">Book Mode (Pagination)</label>
                   <input type="checkbox" id="sb-modal-book-mode" ${settings.bookModeEnabled ? 'checked' : ''}>
                </div>

                <div style="margin-bottom: 15px; border: 1px solid var(--sb-glass-border); padding: 10px; border-radius: 6px; background: rgba(255,255,255,0.02);">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                        <label style="font-weight:600;">Page Animation</label>
                        <input type="checkbox" id="sb-modal-page-flip" ${settings.pageFlipAnimation ? 'checked' : ''}>
                    </div>
                    <div id="sb-flip-settings" style="display: ${settings.pageFlipAnimation ? 'block' : 'none'};">
                        <label style="display:block; margin-bottom: 5px; font-size: 0.85rem; opacity: 0.8;">Animation Style</label>
                        <select id="sb-modal-flip-style" class="text_pole" style="width: 100%; margin-bottom: 10px;">
                            <option value="flip" ${(settings.pageFlipStyle || 'flip') === 'flip' ? 'selected' : ''}>Flip</option>
                            <option value="fade" ${settings.pageFlipStyle === 'fade' ? 'selected' : ''}>Fade</option>
                            <option value="slide" ${settings.pageFlipStyle === 'slide' ? 'selected' : ''}>Slide</option>
                        </select>
                        <label style="display:block; margin-bottom: 5px; font-size: 0.85rem; opacity: 0.8;">Animation Speed: <span id="sb-modal-flip-speed-val">${settings.pageFlipSpeed || 0.4}s</span></label>
                        <input type="range" id="sb-modal-flip-speed" min="0.2" max="1.0" step="0.1" value="${settings.pageFlipSpeed || 0.4}" style="width: 100%;">
                    </div>
                </div>

                <div style="margin-bottom: 15px; border: 1px solid var(--sb-glass-border); padding: 10px; border-radius: 6px; background: rgba(255,255,255,0.02);">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                        <label style="font-weight:600;">Auto-Paginate Long Entries</label>
                        <input type="checkbox" id="sb-modal-auto-paginate" ${settings.autoPaginate ? 'checked' : ''}>
                    </div>
                    <div id="sb-paginate-settings" style="display: ${settings.autoPaginate ? 'block' : 'none'};">
                        <label style="display:block; margin-bottom: 5px; font-size: 0.85rem; opacity: 0.8;">Character Limit per Page</label>
                        <input type="number" id="sb-modal-paginate-limit" class="text_pole" value="${settings.paginateLimit || 2000}" style="width: 100%;">
                    </div>
                </div>

                <div style="margin-bottom: 15px;">
                    <label style="display:block; margin-bottom: 5px; font-weight:600;">Category Shortcuts</label>
                    <div id="sb-modal-shortcuts-list" style="max-height: 120px; overflow-y: auto; border: 1px solid var(--sb-glass-border); padding: 5px; border-radius: 4px;"></div>
                </div>

                <div class="sb-modal-footer">

                    <button class="sb-modal-btn confirm">Done</button>
                </div>
            </div >
            `);

        overlay.append(modal);
        $('body').append(overlay);

        modal.find('#sb-modal-font-scale').on('input', function () {
            const val = parseFloat($(this).val());
            settings.fontScale = val;
            modal.find('#sb-modal-font-val').text(Math.round(val * 100) + '%');
            applyStyles();
            saveSettingsDebounced();
        });

        modal.find('#sb-modal-theme-color').on('input', function () {
            settings.themeColor = $(this).val();
            applyStyles();
            saveSettingsDebounced();
        });

        modal.find('#sb-modal-theme-reset').on('click', function () {
            settings.themeColor = null;
            modal.find('#sb-modal-theme-color').val('#000000');
            applyStyles();
            saveSettingsDebounced();
        });

        modal.find('#sb-modal-default-cat').on('change', function () {
            settings.defaultCategoryId = $(this).val() || null;
            saveSettingsDebounced();
        });

        modal.find('#sb-modal-opacity').on('input', function () {
            const val = parseFloat($(this).val());
            settings.opacity = val;
            modal.find('#sb-modal-opacity-val').text(Math.round(val * 100) + '%');
            applyStyles();
            saveSettingsDebounced();
        });

        modal.find('#sb-modal-auto-paginate').on('change', function () {
            settings.autoPaginate = $(this).is(':checked');
            modal.find('#sb-paginate-settings').toggle(settings.autoPaginate);
            if (settings.autoPaginate) {
                applyAutoPaginationToOpenWindows();
            }
            saveSettingsDebounced();
        });

        modal.find('#sb-modal-paginate-limit').on('change', function () {
            settings.paginateLimit = parseInt($(this).val()) || 1000;
            if (settings.autoPaginate) {
                applyAutoPaginationToOpenWindows();
            }
            saveSettingsDebounced();
        });

        modal.find('#sb-modal-book-mode').on('change', function () {
            settings.bookModeEnabled = $(this).is(':checked');
            renderAllOpenWindows();
            saveSettingsDebounced();
        });

        modal.find('#sb-modal-page-flip').on('change', function () {
            settings.pageFlipAnimation = $(this).is(':checked');
            modal.find('#sb-flip-settings').toggle(settings.pageFlipAnimation);
            saveSettingsDebounced();
        });

        modal.find('#sb-modal-flip-style').on('change', function () {
            settings.pageFlipStyle = $(this).val();
            saveSettingsDebounced();
        });

        modal.find('#sb-modal-flip-speed').on('input', function () {
            const val = parseFloat($(this).val());
            settings.pageFlipSpeed = val;
            modal.find('#sb-modal-flip-speed-val').text(val + 's');
            applyStyles();
            saveSettingsDebounced();
        });

        modal.find('#sb-modal-always-top').on('change', function () {
            settings.alwaysOnTop = $(this).is(':checked');
            applyStyles();
            saveSettingsDebounced();
        });

        const shortcutList = modal.find('#sb-modal-shortcuts-list');
        settings.categories.forEach(cat => {
            const row = $(`<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; padding: 2px;"></div>`);
            const name = $(`<span>${cat.name}</span>`);
            const keyInput = $(`<input type="text" class="text_pole" readonly value="${cat.shortcut || ''}" placeholder="Click to record" style="width: 100px; text-align: center; height: 24px;">`);
            const clearBtn = $(`<i class="fa-solid fa-times" style="cursor: pointer; padding: 5px; opacity: 0.7;"></i>`);

            keyInput.on('focus', function () { $(this).val('Press keys...'); });
            keyInput.on('blur', function () { if ($(this).val() === 'Press keys...') $(this).val(cat.shortcut || ''); });

            keyInput.on('keydown', function (e) {
                e.preventDefault();
                if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Delete') {
                    cat.shortcut = null;
                    $(this).val('');
                    saveSettingsDebounced();
                    $(this).blur();
                    return;
                }
                if (['Control', 'Alt', 'Shift'].includes(e.key)) return;
                const mods = [];
                if (e.ctrlKey) mods.push('Ctrl');
                if (e.altKey) mods.push('Alt');
                if (e.shiftKey) mods.push('Shift');
                const code = [...mods, e.key.toUpperCase()].join('+');
                cat.shortcut = code;
                $(this).val(code);
                saveSettingsDebounced();
                $(this).blur();
            });

            clearBtn.on('click', () => {
                cat.shortcut = null;
                keyInput.val('');
                saveSettingsDebounced();
            });

            row.append(name, $(`<div style="display:flex; align-items:center; gap:5px;"></div>`).append(keyInput, clearBtn));
            shortcutList.append(row);
        });

        const close = () => { modal.remove(); overlay.remove(); resolve(); };
        modal.find('.confirm').on('click', close);
        overlay.on('click', (e) => { if (e.target.id === 'sb-modal-overlay') close(); });
    });
}


function showInputModal(title, defaultValue = '', placeholder = '') {
    return new Promise((resolve) => {
        const modalHtml = `
            <div id="sb-modal-overlay">
                <div class="sb-modal">
                    <h3>${title}</h3>
                    <input type="text" class="sb-modal-input" value="${defaultValue}" placeholder="${placeholder}">
                    <div class="sb-modal-footer">
                        <button class="sb-modal-btn cancel">Cancel</button>
                        <button class="sb-modal-btn confirm">Confirm</button>
                    </div>
                </div>
            </div>
        `;
        const modal = $(modalHtml);
        $('body').append(modal);

        const input = modal.find('input');
        input.focus().select();

        const close = (value) => {
            modal.fadeOut(150, () => modal.remove());
            resolve(value);
        };

        modal.find('.confirm').on('click', () => close(input.val()));
        modal.find('.cancel').on('click', () => close(null));

        input.on('keydown', (e) => {
            if (e.key === 'Enter') close(input.val());
            if (e.key === 'Escape') close(null);
        });

        modal.on('click', (e) => {
            if ($(e.target).is('#sb-modal-overlay')) close(null);
        });
    });
}

function showConfirmModal(message, title = 'Confirm Action') {
    return new Promise((resolve) => {
        const modalHtml = `
            <div id="sb-modal-overlay">
                <div class="sb-modal">
                    <h3>${title}</h3>
                    <p>${message}</p>
                    <div class="sb-modal-footer">
                        <button class="sb-modal-btn cancel">Cancel</button>
                        <button class="sb-modal-btn confirm">Confirm</button>
                    </div>
                </div>
            </div>
        `;
        const modal = $(modalHtml);
        $('body').append(modal);

        const close = (value) => {
            modal.fadeOut(150, () => modal.remove());
            resolve(value);
        };

        modal.find('.confirm').on('click', () => close(true));
        modal.find('.cancel').on('click', () => close(false));

        modal.on('click', (e) => {
            if ($(e.target).is('#sb-modal-overlay')) close(false);
        });
    });
}


function setupCategorySelector(windowEl, windowCategory) {
    const settings = extension_settings[MODULE_NAME];

    windowEl.find('.sb-category-selector').off('click').on('click', function (e) {
        e.stopPropagation();
        const dropdown = windowEl.find('.sb-category-dropdown');
        if (dropdown.is(':visible')) {
            dropdown.hide();
            return;
        }

        dropdown.empty();
        const currentWindowId = windowEl.attr('data-id');

        settings.categories.forEach(cat => {
            const item = $(`
                <div class="sb-cat-item ${cat.id === windowCategory.id ? 'active' : ''}">
                    <i class="fa-solid ${cat.icon || 'fa-hat-wizard'} sb-cat-icon-display"></i>
                    <span class="sb-cat-name">${cat.name}</span>
                    <div class="sb-cat-actions">
                        <i class="fa-solid fa-up-right-from-square sb-cat-popout" title="Pop out into new window" style="${cat.id === currentWindowId ? 'display:none' : ''}"></i>
                        <i class="fa-solid fa-image sb-cat-bg" title="Set Background"></i>
                        <i class="fa-solid fa-icons sb-cat-change-icon" title="Change Icon"></i>
                        <i class="fa-solid fa-pencil sb-cat-edit" title="Rename"></i>
                        <i class="fa-solid fa-trash sb-cat-trash" title="Delete"></i>
                    </div>
                </div>
            `);

            // Switch Category (click anywhere on the row, except action buttons)
            item.on('click', function (e) {
                if ($(e.target).closest('.sb-cat-actions').length) return;
                const existingWin = $(`.sb-container[data-id="${cat.id}"]`);
                if (existingWin.length > 0 && existingWin[0] !== windowEl[0]) {
                    focusWindow(existingWin);
                    dropdown.hide();
                    return;
                }
                windowCategory.windowState.isOpen = false;
                cat.windowState.isOpen = true;
                windowEl.attr('data-id', cat.id);

                // Sync lock state to new category
                const lockBtn = windowEl.find('.sb-lock-btn');
                if (cat.windowState.isLocked) {
                    windowEl.addClass('sb-locked');
                    lockBtn.removeClass('fa-lock-open').addClass('fa-lock').addClass('active');
                    lockBtn.css({ 'opacity': '1', 'color': 'var(--sb-accent)' });
                } else {
                    windowEl.removeClass('sb-locked');
                    lockBtn.removeClass('fa-lock').addClass('fa-lock-open').removeClass('active');
                    lockBtn.css({ 'opacity': '0.5', 'color': '' });
                }

                setupCategorySelector(windowEl, cat);
                renderFullUI(windowEl, cat);
                focusWindow(windowEl);
                dropdown.hide();
                saveSettingsDebounced();
            });

            // Pop Out
            item.find('.sb-cat-popout').on('click', (e) => {
                e.stopPropagation();
                cat.windowState.isOpen = true;
                createWindow(cat);
                dropdown.hide();
                saveSettingsDebounced();
            });

            // Background
            item.find('.sb-cat-bg').on('click', async (e) => {
                e.stopPropagation();
                dropdown.hide();
                const result = await showBackgroundModal(cat.background, cat.backgroundPos, cat.backgroundBlur);
                if (result) {
                    cat.background = result.url;
                    cat.backgroundPos = result.pos;
                    cat.backgroundBlur = result.blur;
                    if (windowCategory.id === cat.id) {
                        renderFullUI(windowEl, cat);
                    }
                    saveSettingsDebounced();
                }
            });

            // Icons
            item.find('.sb-cat-change-icon').on('click', async (e) => {
                e.stopPropagation();
                dropdown.hide();
                await showIconModal(cat, windowEl);
            });

            // Rename
            item.find('.sb-cat-edit').on('click', async (e) => {
                e.stopPropagation();
                dropdown.hide();
                const newName = await showInputModal('Rename Category:', 'Rename', cat.name);
                if (newName) {
                    cat.name = newName;
                    if (windowCategory.id === cat.id) {
                        windowEl.find('.sb-title-text').text(cat.name);
                    }
                    saveSettingsDebounced();
                }
            });

            // Delete Category
            item.find('.sb-cat-trash').on('click', async (e) => {
                e.stopPropagation();
                if (settings.categories.length === 1) {
                    toastr.error('Cannot delete the last category');
                    return;
                }
                if (await showConfirmModal(`Delete category "${cat.name}" and all its entries?`)) {
                    settings.categories = settings.categories.filter(c => c.id !== cat.id);
                    $(`.sb-container[data-id="${cat.id}"]`).remove();
                    if (windowCategory.id === cat.id) {
                        windowEl.remove();
                    }
                    saveSettingsDebounced();
                    dropdown.hide();
                    toastr.info('Category deleted');
                }
            });

            dropdown.append(item);
        });

        // Add New Category Button
        const addItem = $(`
            <div class="sb-cat-item sb-cat-add">
                <i class="fa-solid fa-plus sb-cat-icon-display"></i>
                <span class="sb-cat-name">New Category</span>
            </div>
        `);
        addItem.on('click', async (e) => {
            e.stopPropagation();
            dropdown.hide();
            const newName = await showInputModal('Name for the new category:', 'New Category');
            if (newName) {
                const newId = Date.now().toString();
                const newCat = {
                    id: newId,
                    name: newName,
                    icon: 'fa-hat-wizard',
                    entries: [{ id: newId + '-entry', name: 'Starting Point', pages: [{ content: '# New Spell Book\n\nStart your journey here...' }] }],
                    windowState: JSON.parse(JSON.stringify(settings.categories[0].windowState))
                };
                newCat.windowState.isOpen = true;
                settings.categories.push(newCat);
                createWindow(newCat);
                saveSettingsDebounced();
            }
        });
        dropdown.append(addItem);
        dropdown.show();
    });

    // Outer click to hide
    $(document).off('click.cat-' + windowCategory.id).on('click.cat-' + windowCategory.id, (e) => {
        if (!$(e.target).closest('.sb-category-selector').length) {
            windowEl.find('.sb-category-dropdown').hide();
        }
    });

    // Rename via click header
    windowEl.find('.sb-category-name').off('dblclick').on('dblclick', function (e) {
        e.stopPropagation();
        const currentName = windowCategory.name;
        const input = $(`<input type="text" class="sb-inline-input sb-cat-input" value="${currentName}">`);
        $(this).replaceWith(input);
        input.focus().select();

        const finishRename = () => {
            windowCategory.name = input.val().trim() || currentName;
            input.replaceWith(`<span class="sb-category-name">${windowCategory.name}</span>`);
            // Update title as well
            windowEl.find('.sb-title-text').text(windowCategory.name);
            saveSettingsDebounced();
        };

        input.on('blur', finishRename);
        input.on('keydown', (e) => {
            if (e.key === 'Enter') finishRename();
            if (e.key === 'Escape') { input.val(currentName); finishRename(); }
        });
    });

    // Hide dropdown when clicking elsewhere
    $(document).off('click.catDropdown-' + windowCategory.id).on('click.catDropdown-' + windowCategory.id, (e) => {
        if (!$(e.target).closest('.sb-category-selector').length) {
            windowEl.find('.sb-category-dropdown').hide();
        }
    });
}

function createWindow(category) {
    const settings = extension_settings[MODULE_NAME];
    const ws = category.windowState;

    if ($(`.sb-container[data-id="${category.id}"]`).length > 0) {
        $(`.sb-container[data-id="${category.id}"]`).show().addClass('sb-focus');
        return;
    }

    const containerHtml = `
    <div class="sb-container" data-id="${category.id}">
            <div class="sb-background-layer"></div>
            <div class="sb-header">
                <div class="sb-controls-left">
                    <i class="fa-solid fa-expand sb-control-btn sb-fullscreen-btn" title="Toggle Fullscreen"></i>
                    <i class="fa-solid ${ws.isLocked ? 'fa-lock' : 'fa-lock-open'} sb-control-btn sb-lock-btn ${ws.isLocked ? 'active' : ''}" title="Lock Window" style="margin-left: 4px; ${ws.isLocked ? 'color: var(--sb-accent); opacity: 1;' : 'opacity: 0.5;'}"></i>
                </div>
                <div class="sb-title sb-category-selector" title="Switch Category">
                    <i class="fa-solid ${category.icon || 'fa-hat-wizard'} sb-icon-main"></i>
                    <span class="sb-title-text">${category.name}</span>
                    <i class="fa-solid fa-chevron-down sb-cat-chevron"></i>
                </div>
                <div class="sb-category-dropdown"></div>
                <div class="sb-controls">
                    <i class="fa-solid fa-pencil sb-control-btn sb-edit-btn" title="Edit Mode" style="margin-right: 8px;"></i>
                    
                    <i class="fa-solid fa-gear sb-control-btn sb-settings-btn" title="Settings" style="margin-right: 8px;"></i>

                    <!-- Window Controls -->
                    <i class="fa-solid fa-xmark sb-control-btn sb-close-btn" title="Close"></i>
                </div>
            </div>
            <div class="sb-main">
                <div class="sb-sidebar" style="width: ${ws.sidebarWidth || '180px'};">
                    <div class="sb-sidebar-resizer"></div>
                    <div class="sb-sidebar-header">
                        <span>Entries</span>
                        <div class="sb-add-entry-btn" title="Add Entry"><i class="fa-solid fa-plus"></i></div>
                    </div>
                    <ul class="sb-page-list"></ul>
                </div>
                <div class="sb-content-wrapper">
                    <div class="sb-content"></div>
                    <div class="sb-editor-container" style="display:none;">
                        <div class="sb-editor-toolbar">
                            <!-- Toolbar Items -->
                            <div class="sb-fmt-group">
                                <i class="fa-solid fa-bold sb-fmt-btn" data-format="bold" title="Bold"></i>
                                <i class="fa-solid fa-italic sb-fmt-btn" data-format="italic" title="Italic"></i>
                                <i class="fa-solid fa-strikethrough sb-fmt-btn" data-format="strikethrough" title="Strikethrough"></i>
                            </div>
                            <div class="sb-fmt-group">
                                <select class="sb-fmt-select" title="Headings">
                                    <option value="">H?</option>
                                    <option value="h1">H1</option>
                                    <option value="h2">H2</option>
                                    <option value="h3">H3</option>
                                </select>
                            </div>
                            <div class="sb-fmt-group">
                                <i class="fa-solid fa-link sb-fmt-btn" data-format="link" title="Link"></i>
                                <i class="fa-solid fa-image sb-fmt-btn" data-format="image" title="Image"></i>
                                <i class="fa-solid fa-code sb-fmt-btn" data-format="code" title="Code"></i>
                            </div>
                            <div class="sb-fmt-group">
                                <i class="fa-solid fa-quote-left sb-fmt-btn" data-format="quote" title="Quote"></i>
                                <i class="fa-solid fa-list-ul sb-fmt-btn" data-format="bullet" title="Bullets"></i>
                                <i class="fa-solid fa-list-ol sb-fmt-btn" data-format="number" title="Numbers"></i>
                                <i class="fa-solid fa-check-square sb-fmt-btn" data-format="task" title="Tasks"></i>
                            </div>
                            <!-- Actions -->
                            <div class="sb-editor-actions-right">
                                <i class="fa-solid fa-check sb-save-edit-btn" title="Save Changes"></i>
                                <i class="fa-solid fa-xmark sb-cancel-edit-btn" title="Cancel Editing"></i>
                            </div>
                        </div>
                        <textarea class="sb-editor" placeholder="Type your markdown here..."></textarea>
                    </div>
                </div>
            </div>
        </div>
        `;

    const windowEl = $(containerHtml);
    $('body').append(windowEl);

    const sidebar = windowEl.find('.sb-sidebar');
    const content = windowEl.find('.sb-content');

    // Apply state
    windowEl.css({
        top: ws.top || '100px',
        left: ws.left || '100px',
        width: ws.width || '650px',
        height: ws.height || '550px',
        display: 'flex'
    });
    if (ws.isFullscreen) windowEl.addClass('sb-fullscreen');
    if (ws.isLocked) windowEl.addClass('sb-locked');

    // Focus handling
    windowEl.on('mousedown', () => {
        focusWindow(windowEl);
    });


    // Hide dropdown when clicking elsewhere
    $(document).off('click.catDropdown-' + category.id).on('click.catDropdown-' + category.id, (e) => {
        if (!$(e.target).closest('.sb-category-selector').length) {
            windowEl.find('.sb-category-dropdown').hide();
        }
    });

    // Button Handlers
    windowEl.find('.sb-settings-btn').on('click', (e) => {
        e.stopPropagation();
        showSettingsModal();
    });

    windowEl.find('.sb-close-btn').on('click', (e) => {
        e.stopPropagation();
        const currentCat = getCategoryById(windowEl.attr('data-id'));
        if (currentCat) currentCat.windowState.isOpen = false;
        windowEl.remove();
        saveSettingsDebounced();
    });

    windowEl.find('.sb-fullscreen-btn').on('click', (e) => {
        e.stopPropagation();
        const currentCat = getCategoryById(windowEl.attr('data-id'));
        if (!currentCat) return;
        const cws = currentCat.windowState;

        windowEl.toggleClass('sb-fullscreen');
        cws.isFullscreen = windowEl.hasClass('sb-fullscreen');
        const icon = windowEl.find('.sb-fullscreen-btn');
        if (cws.isFullscreen) icon.removeClass('fa-expand').addClass('fa-compress');
        else icon.removeClass('fa-compress').addClass('fa-expand');

        focusWindow(windowEl); // Re-apply z-index logic for fullscreen
        saveSettingsDebounced();
    });

    windowEl.find('.sb-edit-btn').on('click', () => {
        const currentCat = getCategoryById(windowEl.attr('data-id'));
        if (currentCat) toggleEditMode(windowEl, currentCat, true);
    });
    windowEl.find('.sb-cancel-edit-btn').on('click', () => {
        const currentCat = getCategoryById(windowEl.attr('data-id'));
        if (currentCat) toggleEditMode(windowEl, currentCat, false);
    });
    windowEl.find('.sb-content').on('dblclick', () => {
        const currentCat = getCategoryById(windowEl.attr('data-id'));
        if (currentCat) toggleEditMode(windowEl, currentCat, true);
    });

    windowEl.find('.sb-save-edit-btn').on('click', () => {
        const currentCat = getCategoryById(windowEl.attr('data-id'));
        if (!currentCat) return;
        const page = getActivePage(currentCat);
        const settings = extension_settings[MODULE_NAME];

        if (page) {
            page.content = windowEl.find('.sb-editor').val();

            // Auto-Paginate if enabled
            if (settings.autoPaginate) {
                const entry = currentCat.entries.find(e => e.id === currentCat.windowState.activeEntryId);
                if (entry) {
                    // Logic: Auto-paginate only the current page's content into multiple if needed
                    // But if we have 5 pages and we edit page 2, we might want to push overflow to page 3.
                    // To keep it simple: Auto-paginate redistributes the WHOLE ENTRY content.
                    const fullContent = entry.pages.map(p => p.content).join('\n\n');
                    const limit = settings.paginateLimit || 2000;

                    if (fullContent.length > limit) {
                        const newPages = [];
                        let remaining = fullContent;
                        while (remaining.length > limit) {
                            let splitIdx = remaining.lastIndexOf('\n', limit);
                            if (splitIdx === -1 || splitIdx < limit * 0.8) splitIdx = limit;
                            newPages.push({ content: remaining.substring(0, splitIdx).trim() });
                            remaining = remaining.substring(splitIdx).trim();
                        }
                        if (remaining.length > 0) newPages.push({ content: remaining });
                        entry.pages = newPages;
                        toastr.info(`Auto-paginated into ${newPages.length} pages`);
                    }
                }
            }

            updateContentUI(windowEl, currentCat);
            toggleEditMode(windowEl, currentCat, false);
            saveSettingsDebounced();
        }
    });

    // Per-Window Lock Button
    windowEl.find('.sb-lock-btn').on('click', function (e) {
        e.stopPropagation();
        const currentCat = getCategoryById(windowEl.attr('data-id'));
        if (!currentCat) return;
        const cws = currentCat.windowState;
        cws.isLocked = !cws.isLocked;

        const btn = $(this);
        if (cws.isLocked) {
            windowEl.addClass('sb-locked');
            btn.removeClass('fa-lock-open').addClass('fa-lock').addClass('active');
            btn.css({ 'opacity': '1', 'color': 'var(--sb-accent)' });
        } else {
            windowEl.removeClass('sb-locked');
            btn.removeClass('fa-lock').addClass('fa-lock-open').removeClass('active');
            btn.css({ 'opacity': '0.5', 'color': '' });
        }
        saveSettingsDebounced();
    });

    // Formatting Toolbar
    windowEl.find('.sb-fmt-btn').on('click', function () {
        const format = $(this).data('format');
        const editor = windowEl.find('.sb-editor')[0];
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const text = editor.value;
        const selected = text.substring(start, end) || 'text';

        const formats = {
            bold: { before: '**', after: '**' },
            italic: { before: '*', after: '*' },
            strikethrough: { before: '~~', after: '~~' },
            link: { before: '[', after: '](url)' },
            image: { before: '![', after: '](image-url)' },
            code: { before: '`', after: '`' },
            quote: { before: '> ', after: '', line: true },
            bullet: { before: '- ', after: '', line: true },
            number: { before: '1. ', after: '', line: true },
            task: { before: '- [ ] ', after: '', line: true }
        };

        if (formats[format]) {
            const f = formats[format];
            const newText = text.substring(0, start) + f.before + selected + f.after + text.substring(end);
            editor.value = newText;
            editor.focus();
            editor.setSelectionRange(start + f.before.length, start + f.before.length + selected.length);
        }
    });

    windowEl.find('.sb-fmt-select').on('change', function () {
        const value = $(this).val();
        if (!value) return;
        const editor = windowEl.find('.sb-editor')[0];
        const start = editor.selectionStart;
        const text = editor.value;
        const lineStart = text.lastIndexOf('\n', start - 1) + 1;
        const headings = { h1: '# ', h2: '## ', h3: '### ' };
        const prefix = headings[value] || '';
        editor.value = text.substring(0, lineStart) + prefix + text.substring(lineStart);
        editor.focus();
        $(this).val('');
    });

    // Sidebar Logic
    windowEl.find('.sb-add-entry-btn').on('click', (e) => {
        e.stopPropagation();
        const currentCat = getCategoryById(windowEl.attr('data-id'));
        if (!currentCat) return;

        const newId = Date.now().toString();
        if (!currentCat.entries) currentCat.entries = [];
        currentCat.entries.push({
            id: newId,
            name: `New Entry ${currentCat.entries.length + 1}`,
            pages: [{ content: '# New Page\n\n...' }]
        });
        currentCat.windowState.activeEntryId = newId;
        currentCat.windowState.activePageIndex = 0;
        renderFullUI(windowEl, currentCat);
        saveSettingsDebounced();
    });

    // Sidebar Resize
    const resizer = windowEl.find('.sb-sidebar-resizer');
    resizer.on('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = sidebar.width();
        const doDrag = (m) => {
            const newWidth = Math.max(150, Math.min(600, startWidth + m.clientX - startX));
            sidebar.width(newWidth);
        };
        const stopDrag = () => {
            $(document).off('mousemove', doDrag);
            $(document).off('mouseup', stopDrag);
            const currentCat = getCategoryById(windowEl.attr('data-id'));
            if (currentCat) currentCat.windowState.sidebarWidth = sidebar.width() + 'px';
            saveSettingsDebounced();
        };
        $(document).on('mousemove', doDrag);
        $(document).on('mouseup', stopDrag);
    });

    // Drag Implementation
    const header = windowEl.find('.sb-header');
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    header.on('mousedown', (e) => {
        if ($(e.target).hasClass('sb-control-btn') || $(e.target).closest('.sb-title').length) return;
        const currentCat = getCategoryById(windowEl.attr('data-id'));
        if (currentCat?.windowState?.isLocked) return;
        isDragging = true;
        dragOffsetX = e.clientX - windowEl.offset().left;
        dragOffsetY = e.clientY - windowEl.offset().top;
        header.css('cursor', 'grabbing');
    });

    $(document).on('mousemove', (e) => {
        if (!isDragging) return;
        windowEl.css({
            left: e.clientX - dragOffsetX,
            top: e.clientY - dragOffsetY
        });
    });

    $(document).on('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            header.css('cursor', 'grab');
            const currentCat = getCategoryById(windowEl.attr('data-id'));
            if (currentCat) {
                currentCat.windowState.top = windowEl.css('top');
                currentCat.windowState.left = windowEl.css('left');
            }
            saveSettingsDebounced();
        }
    });

    // Resize tracking
    const observer = new ResizeObserver(() => {
        if (windowEl.hasClass('sb-fullscreen')) return;
        const currentCat = getCategoryById(windowEl.attr('data-id'));
        if (currentCat) {
            currentCat.windowState.width = windowEl.css('width');
            currentCat.windowState.height = windowEl.css('height');
        }
        saveSettingsDebounced();
    });
    observer.observe(windowEl[0]);

    setupCategorySelector(windowEl, category);
    renderFullUI(windowEl, category);
    focusWindow(windowEl);
}

function toggleSpellBook() {
    const settings = extension_settings[MODULE_NAME];
    let catId = settings.defaultCategoryId;
    let cat = null;

    if (catId) {
        cat = settings.categories.find(c => c.id === catId);
    }

    // Fallback to first category if default is invalid or not set
    if (!cat && settings.categories.length > 0) {
        cat = settings.categories[0];
    }

    if (cat) {
        // Toggle logic: if open, close? Or just ensure open?
        // Standard behavior: Toggle specific window if it's the target.
        // If we click the global button, maybe we just want to OPEN default.
        // Let's say: If the default category window is already open, close it. Else open it.
        // Wait, if we use this for shortcuts, we might want "Focus if open, Open if closed".
        // The global button usually Toggles.

        if (cat.windowState.isOpen) {
            // If already open, close it to toggle? 
            // Or maybe focus it?
            // Let's stick to toggle for the main button behavior.
            const win = $(`.sb-container[data-id="${cat.id}"]`);
            if (win.length) {
                win.find('.sb-close-btn').click();
                return;
            }
        }

        cat.windowState.isOpen = true;
        createWindow(cat);
        saveSettingsDebounced();
    }
}

function getDynamicBaseZIndex() {
    // Check Preference
    const settings = extension_settings[MODULE_NAME];
    if (settings.alwaysOnTop === false) {
        return 2100; // Static "Under Drawer" mode
    }

    // Refining targets to be specific to the Right Drawer (Character Card)
    // Removing #top-bar as it likely caused the "Above Everything" issue
    /* 
    const targets = [
        '#right-nav-panel',     // Primary target
        '#rm_char_block',       // Specific char block
        '.right-drawer'         // Generic right drawer class
    ];
    */

    // Fallback: 3000
    // Logic: 2500 was "Under Char Card", 9500 was "Above Settings".
    // So the Char Card is likely ~2600-3000.
    // User verified Char Card Z is 3000.
    // Fallback: 3000 (Resulting in 3001) if detection fails or is equal.

    // User Request: Force 3003. No dynamic calculation.
    return 3003;
}

function clampWindowsToViewport() {
    const vw = $(window).width();
    const vh = $(window).height();

    $('.sb-container').each(function () {
        const win = $(this);
        // Skip fullscreen windows as they are managed by CSS
        if (win.hasClass('sb-fullscreen')) return;

        let left = parseInt(win.css('left'));
        let top = parseInt(win.css('top'));
        let width = win.outerWidth();
        let height = win.outerHeight();
        let changed = false;

        // Clamp positions
        if (left + width > vw) {
            left = Math.max(0, vw - width);
            changed = true;
        }
        if (top + height > vh) {
            top = Math.max(0, vh - height);
            changed = true;
        }

        // Final sanity check for size (if window is larger than viewport)
        if (width > vw) {
            width = vw - 20; // Padding
            left = 10;
            win.css('width', width + 'px');
        }
        if (height > vh) {
            height = vh - 20;
            top = 10;
            win.css('height', height + 'px');
        }

        if (changed) {
            win.css({ left: left + 'px', top: top + 'px' });
        }
    });
}

function focusWindow(windowEl) {
    const baseZ = getDynamicBaseZIndex();

    $('.sb-container').each(function () {
        const win = $(this);
        const isActive = win.is(windowEl);
        const isFS = win.hasClass('sb-fullscreen');

        let z;
        if (isFS) {
            z = isActive ? 60010 : 60000;
        } else {
            // Normal mode: Dynamic Base + 10 for active, Base for inactive
            z = isActive ? (baseZ + 10) : baseZ;
        }

        win.toggleClass('sb-focus', isActive).css('zIndex', z);
        if (isActive) win.show();
    });
}

async function init() {
    try {
        loadSettings();
        await settingsLoaded();
        const settings = extension_settings[MODULE_NAME];
        settings.categories.forEach(cat => {
            if (cat.windowState && cat.windowState.isOpen) {
                if (settings.isEnabled) {
                    createWindow(cat);
                }
            }
        });

        if (settings.isEnabled) {
            applyStyles(); // Apply global transparency/font styles
            if ($('#spell-book-button').length === 0) {
                const menuButton = $(`<div id="spell-book-button" class="list-group-item flex-container" title="Toggle The Spell Book"><i class="fa-solid fa-hat-wizard" style="margin-right:5px"></i> The Spell Book</div>`);
                menuButton.on('click', toggleSpellBook);
                const menuSelectors = ['#extensionsMenu', '#extensionsMenuContent', '.extensionsMenu'];
                for (const selector of menuSelectors) {
                    if ($(selector).length > 0) {
                        $(selector).append(menuButton);
                        break;
                    }
                }
            }
        }

        // Attach Resize Listener immediately
        $(window).on('resize', () => {
            clampWindowsToViewport();
        });
        // Run once on init to catch any bounds issues
        clampWindowsToViewport();

    } catch (e) {
        console.error('Spell Book Init Error:', e);
        toastr.error('Spell Book failed to load. Check console.');
    }

    // Global Shortcut Listener
    $(document).on('keydown.sb-shortcuts', (e) => {
        const settings = extension_settings[MODULE_NAME];
        if (!settings.isEnabled) return;

        // Ignore if typing in an input/textarea
        if ($(e.target).is('input, textarea, [contenteditable]')) return;

        const modifiers = [];
        if (e.ctrlKey) modifiers.push('Ctrl');
        if (e.altKey) modifiers.push('Alt');
        if (e.shiftKey) modifiers.push('Shift');

        // Ignore if only modifier pressed
        if (['Control', 'Alt', 'Shift'].includes(e.key)) return;

        const key = e.key.toUpperCase();
        const shortcutString = [...modifiers, key].join('+');

        const targetCat = settings.categories.find(c => c.shortcut === shortcutString);

        if (targetCat) {
            e.preventDefault();
            e.stopPropagation();

            // Logic: If open and focused, close? No, keybind usually strictly means "Bring me this".
            // If dragging closed, open. If open, bring to front. 
            // If already front, maybe close? 
            // Let's implement "Toggle if active, else Open/Focus".

            const win = $(`.sb - container[data - id="${targetCat.id}"]`);
            if (win.length && win.is(':visible')) {
                if (win.hasClass('sb-focus')) {
                    // Active and focused -> Toggle Close
                    win.find('.sb-close-btn').click();
                } else {
                    // Open but background -> Focus
                    focusWindow(win);
                }
            } else {
                // Closed -> Open
                targetCat.windowState.isOpen = true;
                createWindow(targetCat);
                saveSettingsDebounced();
            }
        }
    });
}

function renderAllOpenWindows() {
    const settings = extension_settings[MODULE_NAME];
    settings.categories.forEach(cat => {
        if (cat.windowState && cat.windowState.isOpen) {
            const win = $(`.sb - container[data - id="${cat.id}"]`);
            if (win.length && win.is(':visible')) {
                renderFullUI(win, cat);
            }
        }
    });
}

export async function settingsLoaded() {
    const settingsHtml = await renderExtensionTemplateAsync(MODULE_NAME, 'settings');
    const settingsPage = $(settingsHtml);

    settingsPage.find('#spell-book-reset').on('click', () => {
        resetSettings();
        toastr.success('Spell Book reset to defaults');
    });

    settingsPage.find('#spell-book-export-btn').on('click', exportData);
    settingsPage.find('#spell-book-import-btn').on('click', importData);

    const enableToggle = settingsPage.find('#sb-enable-toggle');
    enableToggle.prop('checked', extension_settings[MODULE_NAME].isEnabled !== false);
    enableToggle.on('change', function () {
        extension_settings[MODULE_NAME].isEnabled = $(this).prop('checked');
        saveSettingsDebounced();
        location.reload(); // Simplest way to re-init extension state
    });

    const alwaysOnTopToggle = settingsPage.find('#sb-always-on-top-toggle');
    alwaysOnTopToggle.prop('checked', extension_settings[MODULE_NAME].alwaysOnTop !== false);
    alwaysOnTopToggle.on('change', function () {
        extension_settings[MODULE_NAME].alwaysOnTop = $(this).prop('checked');
        // Force re-focus to apply new Z-index immediately
        $('.sb-container').each(function () { focusWindow($(this)); });
        saveSettingsDebounced();
    });

    $('#extensions_settings').append(settingsPage);
}

jQuery(async () => {
    await init();
});
