<template>
    <div v-if="isOpen" class="modal-overlay" @click.self="close">
        <div id="order-sheet" class="modal-content">
            <h2>{{ orderData?.orderTask.name }}</h2>

            <div class="order-details" v-if="orderData">
                <h3>Order Sheet Info</h3>
                <ul>
                    <li><strong>Client:</strong> {{ getCustomField('🏢 Client') }}</li>
                    <li><strong>Date Ordered:</strong> {{ formatDate(getCustomField('📅 Date Ordered')) }}</li>
                    <li><strong>Date Requested by Client:</strong> {{ formatDate(getCustomField('📅 Date Requested by Client')) }}</li>
                    <li><strong>Title Scope:</strong> {{ getCustomField('📜 Title Scope Parameters') }}</li>
                    <li><strong>Delivery Email:</strong> {{ getCustomField('📨 Delivery email') }}</li>
                    <li><strong>Include Property Profile?</strong> {{ getCustomField('🗺️ Include Property Profile Report?') ? 'Yes' : 'No' }}</li>
                    <li><strong>Delivery Instructions:</strong> {{ getCustomField('Delivery Instructions') }}</li>
                </ul>

                <h3>Parcels on Order Sheet</h3>
                <table>
                    <thead>
                        <tr>
                            <th>Parcel Name</th>
                            <th>Parcel ID</th>
                            <th>Address</th>
                            <th>County, ST</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="parcel in orderData.parcels" :key="parcel.id">
                            <td>{{ parcel.name }}</td>
                            <td>{{ getParcelField(parcel, 'Parcel_ID') }}</td>
                            <td>{{ getParcelField(parcel, 'Property Address') }}</td>
                            <td>{{ getParcelField(parcel, 'County, ST') }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <button class="action-button" @click="generatePDF">Download PDF</button>
            <button class="close-button" @click="close">Close</button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import axios from 'axios';
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";


const props = defineProps<{ isOpen: boolean; task: any }>();
const emit = defineEmits(['close']);

const orderData = ref<any>(null);

const fetchOrderData = async () => {
    try {
        const response = await axios.get(`http://localhost:3000/api/ordersheet/${props.task.id}/full`);
        console.log('Raw API Response:', response.data);
        orderData.value = response.data;
    } catch (error) {
        console.error('Error fetching order data:', error);
    }
};

watch(() => props.isOpen, (open) => {
    if (open && props.task) {
        fetchOrderData();
    }
});

const close = () => {
    emit('close');
    orderData.value = null;
};

const getCustomField = (name: string) => {
    const field = orderData.value.orderTask.custom_fields.find((f: any) => f.name.includes(name.trim()));

    if (!field || field.value === undefined || field.value === null) return '—';

    switch (field.type) {
        case 'date':
            return field.value;
        case 'drop_down':
            return field.type_config.options[field.value]?.name || '—';
        case 'checkbox':
            return field.value === 'true' ? 'Yes' : 'No';
        default:
            return field.value;
    }
};

const getParcelField = (parcel: any, fieldName: string) => {
    const field = parcel.custom_fields.find((f: any) => f.name.includes(fieldName.trim()));

    if (!field) return '—';

    if (fieldName.includes('Property Address') && typeof field.value === 'object') {
        return field.value.formatted_address || '—';
    }

    return field.value ?? '—';
};

const formatDate = (timestamp: string | number) => {
    if (!timestamp) return '—';
    const tsNum = Number(timestamp);
    if (isNaN(tsNum)) return '—';
    const date = new Date(tsNum);
    return date.toLocaleDateString();
};

const generatePDF = () => {
  if (!orderData.value) {
    console.error("No order data available.");
    return;
  }

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    lineHeightFactor: 1.2,
  });

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(orderData.value.orderTask.name, 105, 15, { align: "center" });

  // Order Sheet Info Title
  doc.setFontSize(11);
  doc.text("Order Sheet Info", 14, 25);

  // Order Details (Two-Column Table)
  const details = [
    ["Client:", getCustomField("🏢 Client")],
    ["Date Ordered:", formatDate(getCustomField("📅 Date Ordered"))],
    ["Date Requested by Client:", formatDate(getCustomField("📅 Date Requested by Client"))],
    ["Title Scope:", getCustomField("📜 Title Scope Parameters")],
    ["Delivery Email:", getCustomField("📨 Delivery email")],
    ["Include Property Profile?", getCustomField("🗺️ Include Property Profile Report?") ? "Yes" : "No"],
  ];

  autoTable(doc, {
    startY: 28,
    head: [["Field", "Value"]],
    body: details,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 50 } },
    margin: { left: 14, right: 14 },
  });

  // Delivery Instructions with Wrapping
  let yPosition = doc.lastAutoTable.finalY + 5;
  doc.setFont("helvetica", "bold");
  doc.text("Delivery Instructions:", 14, yPosition);
  doc.setFont("helvetica", "normal");

  const instructions = getCustomField("Delivery Instructions") || "—";
  const wrappedInstructions = doc.splitTextToSize(instructions, 170);
  doc.text(wrappedInstructions, 14, yPosition + 5);
  yPosition += wrappedInstructions.length * 5 + 5;

  // Table Title
  doc.setFont("helvetica", "bold");
  doc.text("Parcels on Order Sheet", 14, yPosition);
  yPosition += 5;

  // Parcel Table with Better Layout
  const tableData = orderData.value.parcels.map((parcel) => [
    parcel.name,
    getParcelField(parcel, "Parcel_ID"),
    getParcelField(parcel, "Property Address"),
    getParcelField(parcel, "County, ST"),
  ]);

  autoTable(doc, {
    startY: yPosition,
    head: [["Parcel Name", "Parcel ID", "Address", "County, ST"]],
    body: tableData,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [40, 167, 69], textColor: 255, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 40 }, // Parcel Name
      1: { cellWidth: 30 }, // Parcel ID
      2: { cellWidth: 70 }, // Address
      3: { cellWidth: 40 }, // County, ST
    },
    margin: { left: 14, right: 14 },
  });

  // Save PDF with dynamic filename
  doc.save(`Title_Report_Order_${orderData.value.orderTask.name}.pdf`);
};









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
    max-width: 800px;
    max-height: 90vh;
    overflow-y: auto;
    color: white;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
}

.order-details ul {
    text-align: left;
}

.order-details li {
    margin-bottom: 0.5rem;
}

table {
    width: 100%;
    margin-top: 1rem;
    border-collapse: collapse;
}

th, td {
    border: 1px solid #444;
    padding: 0.5rem;
}

th {
    background-color: #333;
}

.action-button, .close-button {
    background-color: #333;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    cursor: pointer;
    border-radius: 4px;
    margin-top: 1rem;
}

.action-button:hover, .close-button:hover {
    background-color: #444;
}
</style>
