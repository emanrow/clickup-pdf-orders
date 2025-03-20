<template>
  <div v-if="isOpen" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <h3>{{ task?.name }}</h3>
      <pre>{{ task }}</pre>
      <button class="close-button" @click="$emit('close')">Close</button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  isOpen: boolean;
  task: any;
}>();

defineEmits<{
  (e: 'close'): void;
}>();
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background-color: #1a1a1a;
  padding: 2rem;
  border-radius: 8px;
  max-width: 80%;
  max-height: 80vh;
  overflow-y: auto;
  color: #ffffff;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.modal-content h3 {
  margin-top: 0;
  color: #ffffff;
}

.modal-content pre {
  background-color: #2a2a2a;
  padding: 1rem;
  border-radius: 4px;
  overflow-x: auto;
  margin: 1rem 0;
}

.close-button {
  background-color: #2a2a2a;
  color: #ffffff;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.close-button:hover {
  background-color: #3a3a3a;
}
</style> 