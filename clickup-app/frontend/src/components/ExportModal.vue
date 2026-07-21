<template>
    <div v-if="isOpen" class="modal-overlay" @click.self="close">
        <div class="modal-content">
            <h2>Export a ClickUp List</h2>
            <p class="hint">
                Drill down from your workspace to the list you want, then
                export all of its tasks (including closed ones) as a CSV file.
            </p>

            <nav class="breadcrumbs">
                <button class="crumb" :disabled="loading" @click="navigateTo(0)">Workspaces</button>
                <template v-for="(crumb, i) in path" :key="crumb.type + crumb.id">
                    <span class="sep">›</span>
                    <button class="crumb" :disabled="loading" @click="navigateTo(i + 1)">
                        {{ crumb.name }}
                    </button>
                </template>
            </nav>

            <div v-if="error" class="error">
                {{ error }}
                <button @click="loadCurrentLevel">Retry</button>
            </div>
            <div v-else-if="loading" class="muted">Loading…</div>
            <ul v-else class="items">
                <li v-for="item in items" :key="item.type + item.id">
                    <button
                        class="item"
                        :class="{ selected: item.type === 'list' && selectedList?.id === item.id }"
                        @click="pick(item)"
                    >
                        <span class="icon">{{ ICONS[item.type] }}</span>
                        <span class="item-name">{{ item.name }}</span>
                        <span v-if="item.type !== 'list'" class="chevron">›</span>
                    </button>
                </li>
                <li v-if="!items.length" class="muted empty">Nothing in here.</li>
            </ul>

            <div class="actions">
                <button
                    class="action-button"
                    :disabled="!selectedList || exporting"
                    @click="exportCsv"
                >
                    {{ exportLabel }}
                </button>
                <button class="close-button" @click="close">Close</button>
            </div>
            <p v-if="exportError" class="error">{{ exportError }}</p>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import axios from 'axios';
import { API_URL } from '../config.js';

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits(['close']);

type NodeType = 'team' | 'space' | 'folder' | 'list';
interface Node { type: NodeType; id: string; name: string; }

const ICONS: Record<NodeType, string> = {
    team: '🏢',
    space: '🗂️',
    folder: '📁',
    list: '📋',
};

// Path of containers we've drilled into (never includes a list)
const path = ref<Node[]>([]);
const items = ref<Node[]>([]);
const selectedList = ref<Node | null>(null);

const loading = ref(false);
const error = ref('');
const exporting = ref(false);
const exportError = ref('');

const exportLabel = computed(() => {
    if (exporting.value) return 'Exporting…';
    if (selectedList.value) return `Export "${selectedList.value.name}" as CSV`;
    return 'Select a list to export';
});

// Each level is fetched lazily, only when the user drills into it
const loadCurrentLevel = async () => {
    loading.value = true;
    error.value = '';
    items.value = [];
    try {
        const current = path.value[path.value.length - 1];
        if (!current) {
            const { data } = await axios.get(`${API_URL}/api/teams`);
            items.value = (data || []).map((t: any) => ({ type: 'team', id: t.id, name: t.name }));
        } else if (current.type === 'team') {
            const { data } = await axios.get(`${API_URL}/api/teams/${current.id}/spaces`);
            items.value = (data || []).map((s: any) => ({ type: 'space', id: s.id, name: s.name }));
        } else if (current.type === 'space') {
            const { data } = await axios.get(`${API_URL}/api/spaces/${current.id}/contents`);
            items.value = [
                ...(data.folders || []).map((f: any) => ({ type: 'folder', id: f.id, name: f.name })),
                ...(data.lists || []).map((l: any) => ({ type: 'list', id: l.id, name: l.name })),
            ];
        } else if (current.type === 'folder') {
            const { data } = await axios.get(`${API_URL}/api/folders/${current.id}/lists`);
            items.value = (data || []).map((l: any) => ({ type: 'list', id: l.id, name: l.name }));
        }
    } catch (err) {
        console.error('Error loading ClickUp hierarchy:', err);
        error.value = 'Could not load from ClickUp.';
    } finally {
        loading.value = false;
    }
};

const pick = (item: Node) => {
    if (item.type === 'list') {
        selectedList.value = item;
        return;
    }
    selectedList.value = null;
    path.value = [...path.value, item];
    loadCurrentLevel();
};

// Breadcrumb navigation: 0 = workspace root, i+1 = path[i]
const navigateTo = (depth: number) => {
    selectedList.value = null;
    path.value = path.value.slice(0, depth);
    loadCurrentLevel();
};

const exportCsv = async () => {
    if (!selectedList.value) return;
    exporting.value = true;
    exportError.value = '';
    try {
        const response = await axios.get(
            `${API_URL}/api/export/${selectedList.value.id}`,
            { responseType: 'blob' }
        );

        const contentDisposition = response.headers['content-disposition'];
        const filenameMatch = contentDisposition && contentDisposition.match(/filename="(.+)"/);
        const filename = filenameMatch ? filenameMatch[1] : `clickup_tasks_${selectedList.value.id}.csv`;

        const url = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    } catch (err: any) {
        console.error('Export error:', err);
        exportError.value = err?.response?.status === 404
            ? 'That list has no tasks to export.'
            : 'Export failed — please try again.';
    } finally {
        exporting.value = false;
    }
};

const close = () => {
    emit('close');
};

watch(() => props.isOpen, (open) => {
    if (open) {
        path.value = [];
        selectedList.value = null;
        exportError.value = '';
        loadCurrentLevel();
    }
});
</script>

<style scoped>
.modal-overlay {
    position: fixed;
    top: 0; left: 0; width: 100%; height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
}

.modal-content {
    background-color: #1a1a1a;
    padding: 2rem;
    border-radius: 8px;
    width: 500px;
    max-width: 90vw;
    max-height: 85vh;
    overflow-y: auto;
    color: white;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
    text-align: left;
}

.modal-content h2 {
    margin-top: 0;
}

.hint {
    color: #999;
    font-size: 0.9rem;
}

.breadcrumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    margin-bottom: 0.75rem;
}

.crumb {
    background: none;
    border: none;
    color: #8ea0ff;
    padding: 0.15rem 0.3rem;
    font-size: 0.95rem;
    cursor: pointer;
}

.crumb:hover {
    text-decoration: underline;
}

.sep {
    color: #666;
}

.items {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
    border: 1px solid #333;
    border-radius: 8px;
    max-height: 45vh;
    overflow-y: auto;
}

.items li + li {
    border-top: 1px solid #2a2a2a;
}

.item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    background: none;
    border: none;
    border-radius: 0;
    color: inherit;
    padding: 0.6rem 0.75rem;
    font-size: 0.95rem;
    text-align: left;
    cursor: pointer;
}

.item:hover {
    background-color: #242424;
}

.item.selected {
    background-color: #2c3466;
}

.item-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.chevron {
    color: #666;
}

.empty {
    padding: 0.75rem;
}

.muted {
    color: #aaa;
}

.error {
    color: #ff6b6b;
}

.actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
}

.action-button, .close-button {
    background-color: #333;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    cursor: pointer;
    border-radius: 4px;
}

.action-button:not(:disabled) {
    background-color: #4a5ad1;
}

.action-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.action-button:hover:not(:disabled), .close-button:hover {
    background-color: #444;
}

.action-button:hover:not(:disabled) {
    background-color: #5a6ae1;
}
</style>
