import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithCustomToken, 
  signInAnonymously, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc, 
  onSnapshot, 
  addDoc 
} from 'firebase/firestore';

// === CONFIGURAÇÃO E INICIALIZAÇÃO DO FIREBASE COM GUARDS ===
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);

// Error Handling (Firebase Skill Standard)
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Configuração padrão de exames para inicialização do banco caso esteja vazio
const DEFAULT_EXAMS = [
  { id: '1', nome: 'Ultrassonografia Gestacional', descricao: 'Avaliação obstétrica detalhada do desenvolvimento fetal.', ativo: true },
  { id: '2', nome: 'Ultrassonografia Abdominal', descricao: 'Exame de órgãos internos como fígado, vesícula e rins.', ativo: true },
  { id: '3', nome: 'Ultrassonografia de Joelho', descricao: 'Análise de estruturas articulares, tendões e ligamentos.', ativo: true },
  { id: '4', nome: 'Ultrassonografia de Ombro', descricao: 'Avaliação de manguito rotador e tecidos moles.', ativo: true },
  { id: '5', nome: 'Ultrassonografia Pélvica', descricao: 'Exame preventivo dos órgãos reprodutores femininos.', ativo: true }
];

// Gera horários respeitando intervalo de almoço
const generateSlotsForClass = (classObj: any) => {
  const slots = [];
  const [startH, startM] = classObj.horarioInicio.split(':').map(Number);
  const [endH, endM] = classObj.horarioFim.split(':').map(Number);
  const [lunchStartH, lunchStartM] = classObj.intervaloAlmocoInicio.split(':').map(Number);
  const [lunchEndH, lunchEndM] = classObj.intervaloAlmocoFim.split(':').map(Number);

  let currentMin = startH * 60 + startM;
  const endMin = endH * 60 + endM;
  const lunchStartMin = lunchStartH * 60 + lunchStartM;
  const lunchEndMin = lunchEndH * 60 + lunchEndM;

  let index = 1;
  while (currentMin + 45 <= endMin && slots.length < classObj.quantidadeVagas) {
    const slotEndMin = currentMin + 45;
    const isInLunch = (currentMin >= lunchStartMin && currentMin < lunchEndMin) || 
                      (slotEndMin > lunchStartMin && slotEndMin <= lunchEndMin);

    if (!isInLunch) {
      const h = Math.floor(currentMin / 60);
      const m = currentMin % 60;
      const formattedTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      slots.push({
        id: `slot-${classObj.id}-${index}`,
        aulaId: classObj.id,
        tipoExameId: classObj.tipoExameId,
        data: classObj.data,
        horario: formattedTime,
        status: 'Disponível',
        pacienteId: null
      });
      index++;
    }
    currentMin += 45;
  }
  return slots;
};

export default function App() {
  // --- ESTADOS DO SISTEMA ---
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isAdminMode, setIsAdminMode] = useState<boolean>(false);
  const [currentView, setCurrentView] = useState<string>('welcome'); 
  const [loginTab, setLoginTab] = useState<string>('paciente'); 

  // Listas obtidas em Tempo Real do Firebase
  const [exams, setExams] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [slots, setSlots] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [historyLogs, setHistoryLogs] = useState<any[]>([]);
  const [brandingLogo, setBrandingLogo] = useState<string>(''); // Armazena Base64 da logo personalizada

  // Sessões Ativas
  const [loggedPatient, setLoggedPatient] = useState<any>(null);
  const [loggedAdmin, setLoggedAdmin] = useState<string | null>(null);

  // Formulários
  const [patientForm, setPatientForm] = useState({ primeiroNome: '', whatsapp: '', dataNascimento: '' });
  const [adminLoginForm, setAdminLoginForm] = useState({ usuario: '', senha: '' });

  // Agendamento Ativo (Paciente)
  const [selectedExam, setSelectedExam] = useState<any>(null);
  const [selectedClass, setSelectedClass] = useState<any>(null);
  const [selectedSlot, setSelectedSlot] = useState<any>(null);
  const [patientFullName, setPatientFullName] = useState<string>('');

  // Formulários Administrativos
  const [newExamForm, setNewExamForm] = useState({ nome: '', descricao: '' });
  const [newClassForm, setNewClassForm] = useState({
    nome: '',
    tipoExameId: '',
    data: '',
    horarioInicio: '08:00',
    horarioFim: '18:00',
    intervaloAlmocoInicio: '12:00',
    intervaloAlmocoFim: '13:00',
    quantidadeVagas: 10,
    status: 'Ativa'
  });

  const [toast, setToast] = useState<any>(null);
  const [filterExam, setFilterExam] = useState<string>('Todos');
  const [filterStatus, setFilterStatus] = useState<string>('Todos');
  const [searchPatient, setSearchPatient] = useState<string>('');

  // Auto-fechamento do Toast informativo
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const showToast = (message: string, type = 'success') => {
    setToast({ message, type });
  };

  // --- 1. AUTENTICAÇÃO INICIAL (RULE 3) ---
  useEffect(() => {
    const initAuth = async () => {
      // Mock auth for local dev since rules are public
      setLoading(false);
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u || { uid: "local-dev-user" });
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // --- 2. SINCRONIZAÇÃO EM TEMPO REAL DO FIREBASE (RULE 1 & RULE 2) ---
  useEffect(() => {
    if (!user) return;

    // Monitoramento de Exames
    const pathExams = 'exams';
    const unsubExams = onSnapshot(
      collection(db, pathExams),
      (snapshot) => {
        const examsList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Se o banco de exames estiver totalmente novo e vazio, inicializa com exames padrão
        if (examsList.length === 0) {
          DEFAULT_EXAMS.forEach(async (defaultExam) => {
            try {
              await setDoc(doc(db, pathExams, defaultExam.id), defaultExam);
            } catch (err) {
              handleFirestoreError(err, OperationType.WRITE, pathExams);
            }
          });
        } else {
          setExams(examsList);
        }
      },
      (error) => handleFirestoreError(error, OperationType.LIST, pathExams)
    );

    // Monitoramento de Aulas
    const pathClasses = 'classes';
    const unsubClasses = onSnapshot(
      collection(db, pathClasses),
      (snapshot) => {
        const classesList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setClasses(classesList);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, pathClasses)
    );

    // Monitoramento de Vagas / Slots
    const pathSlots = 'slots';
    const unsubSlots = onSnapshot(
      collection(db, pathSlots),
      (snapshot) => {
        const slotsList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setSlots(slotsList);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, pathSlots)
    );

    // Monitoramento de Pacientes
    const pathPatients = 'patients';
    const unsubPatients = onSnapshot(
      collection(db, pathPatients),
      (snapshot) => {
        const patientsList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setPatients(patientsList);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, pathPatients)
    );

    // Monitoramento de Pré-cadastros / Inscrições
    const pathRegs = 'registrations';
    const unsubRegs = onSnapshot(
      collection(db, pathRegs),
      (snapshot) => {
        const regsList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        regsList.sort((a: any, b: any) => b.criadoEm.localeCompare(a.criadoEm));
        setRegistrations(regsList);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, pathRegs)
    );

    // Monitoramento de Histórico / Auditoria
    const pathHistory = 'history';
    const unsubHistory = onSnapshot(
      collection(db, pathHistory),
      (snapshot) => {
        const logsList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        logsList.sort((a: any, b: any) => b.dataHora.localeCompare(a.dataHora));
        setHistoryLogs(logsList);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, pathHistory)
    );

    // Monitoramento de Identidade Visual / Configurações de Branding
    const pathBranding = 'settings/branding';
    const unsubBranding = onSnapshot(
      doc(db, 'settings', 'branding'),
      (docSnap) => {
        if (docSnap.exists()) {
          setBrandingLogo(docSnap.data().logoBase64 || '');
        }
      },
      (error) => handleFirestoreError(error, OperationType.GET, pathBranding)
    );

    return () => {
      unsubExams();
      unsubClasses();
      unsubSlots();
      unsubPatients();
      unsubRegs();
      unsubHistory();
      unsubBranding();
    };
  }, [user]);

  // --- TRATAMENTO DE LOGIN DE PACIENTE ---
  const handlePatientLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!patientForm.primeiroNome || !patientForm.whatsapp || !patientForm.dataNascimento) {
      showToast('Por favor, preencha todos os campos obrigatórios.', 'error');
      return;
    }
    
    // Procura por paciente existente no banco em memória carregado do Firestore (RULE 2)
    let patient = patients.find(p => p.whatsapp === patientForm.whatsapp);
    
    if (!patient) {
      const patientId = `p-${Date.now()}`;
      const newPatient = {
        id: patientId,
        primeiroNome: patientForm.primeiroNome,
        nomeCompleto: patientForm.primeiroNome,
        whatsapp: patientForm.whatsapp,
        dataNascimento: patientForm.dataNascimento,
        dataCadastro: new Date().toISOString().replace('T', ' ').substring(0, 16)
      };
      
      try {
        await setDoc(doc(db, 'patients', patientId), newPatient);
        patient = newPatient;
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'patients');
      }
    }

    setLoggedPatient(patient);
    setPatientFullName(patient.nomeCompleto || '');
    setIsAdminMode(false);
    showToast(`Bem-vindo, ${patient.primeiroNome}!`);
    setCurrentView('exams');
  };

  // --- TRATAMENTO DE LOGIN ADMINISTRATIVO ---
  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const { usuario, senha } = adminLoginForm;
    
    // Os 3 Logins Oficiais da Área Médica da Gesttus
    const administrativeUsers: any = {
      'admin.master': 'gesttus2026',
      'admin.secretaria': 'gesttus01',
      'admin.docente': 'gesttus02'
    };

    if (administrativeUsers[usuario] && administrativeUsers[usuario] === senha) {
      setLoggedAdmin(usuario);
      setIsAdminMode(true);
      showToast(`Bem-vindo à área médica: ${usuario}`);
      setCurrentView('admin_dashboard');
    } else {
      showToast('Acesso negado. Usuário ou senha de colaborador inválidos.', 'error');
    }
  };

  const handleAdminLogout = () => {
    setLoggedAdmin(null);
    setIsAdminMode(false);
    setAdminLoginForm({ usuario: '', senha: '' });
    setCurrentView('welcome');
    showToast('Sessão médica encerrada.');
  };

  // --- CRIAÇÃO DE TIPO DE EXAME (ADMIN) ---
  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!newExamForm.nome) {
      showToast('Nome do exame é obrigatório.', 'error');
      return;
    }

    const newExamId = `ex-${Date.now()}`;
    const newExam = {
      id: newExamId,
      nome: newExamForm.nome,
      descricao: newExamForm.descricao,
      ativo: true
    };

    try {
      await setDoc(doc(db, 'exams', newExamId), newExam);
      setNewExamForm({ nome: '', descricao: '' });
      showToast('Procedimento cadastrado no catálogo clínico!');
      addHistoryLog('Cadastrou novo tipo de exame: ' + newExam.nome, 'Exame', newExamId, null, 'Ativo');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'exams');
    }
  };

  // --- CADASTRO DE AULA PRÁTICA COM GERAÇÃO DE HORÁRIOS (ADMIN) ---
  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const { nome, tipoExameId, data, horarioInicio, horarioFim, intervaloAlmocoInicio, intervaloAlmocoFim, quantidadeVagas } = newClassForm;

    if (!nome || !tipoExameId || !data) {
      showToast('Preencha os dados obrigatórios da aula.', 'error');
      return;
    }

    const examObj = exams.find(e => e.id === tipoExameId);
    const newClassId = `class-${Date.now()}`;

    const newClass = {
      id: newClassId,
      nome,
      tipoExameId,
      tipoExameNome: examObj ? examObj.nome : 'Ultrassonografia',
      data,
      horarioInicio,
      horarioFim,
      intervaloAlmocoInicio,
      intervaloAlmocoFim,
      quantidadeVagas: Number(quantidadeVagas),
      status: 'Ativa',
      criadoPor: loggedAdmin || 'coordenacao',
      criadoEm: new Date().toISOString().replace('T', ' ').substring(0, 16)
    };

    // Geração automática dos blocos de atendimento respeitando intervalo de almoço
    const generatedSlots = generateSlotsForClass(newClass);

    // Salva a Aula Prática no Firestore
    try {
      await setDoc(doc(db, 'classes', newClassId), newClass);

      // Salva os Slots correspondentes no Firestore de forma sequencial
      for (const slot of generatedSlots) {
        await setDoc(doc(db, 'slots', slot.id), slot);
      }

      showToast(`Aula criada. ${generatedSlots.length} horários disponibilizados!`);
      setCurrentView('admin_classes');
      addHistoryLog(`Cadastrou a aula "${nome}"`, 'Aula', newClassId, null, 'Ativa');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'classes_or_slots');
    }
  };

  // --- SOLICITAÇÃO DE PRÉ-CADASTRO (PACIENTE) ---
  const handleConfirmPreRegistration = async () => {
    if (!user || !loggedPatient || !selectedSlot) return;

    // Valida duplicidade de solicitação no mesmo horário
    const hasDuplicate = registrations.some(
      reg => reg.whatsappPaciente === loggedPatient.whatsapp && 
      reg.data === selectedSlot.data && 
      reg.horario === selectedSlot.horario &&
      reg.status !== 'Cancelada'
    );

    if (hasDuplicate) {
      showToast('Você já possui uma solicitação enviada para este mesmo horário!', 'error');
      return;
    }

    // Atualiza nome completo do paciente se alterado
    if (patientFullName && patientFullName !== loggedPatient.nomeCompleto) {
      try {
        await updateDoc(doc(db, 'patients', loggedPatient.id), {
          nomeCompleto: patientFullName
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, 'patients');
      }
    }

    const newRegId = `reg-${Date.now()}`;
    const newReg = {
      id: newRegId,
      pacienteId: loggedPatient.id,
      aulaId: selectedClass.id,
      vagaId: selectedSlot.id,
      tipoExameId: selectedExam.id,
      nomePaciente: patientFullName || loggedPatient.primeiroNome,
      whatsappPaciente: loggedPatient.whatsapp,
      dataNascimento: loggedPatient.dataNascimento,
      data: selectedSlot.data,
      horario: selectedSlot.horario,
      status: 'Pré-cadastrada',
      criadoEm: new Date().toISOString().replace('T', ' ').substring(0, 16),
      confirmadoPor: null,
      confirmadoEm: null
    };

    // Atualiza status da vaga e grava inscrição no Firestore
    try {
      await updateDoc(doc(db, 'slots', selectedSlot.id), {
        status: 'Pré-cadastrada',
        pacienteId: loggedPatient.id
      });
      await setDoc(doc(db, 'registrations', newRegId), newReg);

      showToast('Solicitação de pré-cadastro efetuada com sucesso!');
      setCurrentView('success');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'registration_or_slot');
    }
  };

  // --- ATUALIZAÇÃO DO STATUS DO PACIENTE (ADMIN) ---
  const handleUpdateRegistrationStatus = async (regId: string, nextStatus: string) => {
    if (!user) return;
    const reg = registrations.find(r => r.id === regId);
    if (!reg) return;

    const prevStatus = reg.status;

    // Atualiza o pré-cadastro
    try {
      await updateDoc(doc(db, 'registrations', regId), {
        status: nextStatus,
        confirmadoPor: loggedAdmin,
        confirmadoEm: new Date().toISOString().replace('T', ' ').substring(0, 16)
      });

      // Atualiza o slot correlacionado
      const nextSlotStatus = nextStatus === 'Cancelada' ? 'Disponível' : nextStatus;
      await updateDoc(doc(db, 'slots', reg.vagaId), {
        status: nextSlotStatus,
        pacienteId: nextStatus === 'Cancelada' ? null : reg.pacienteId
      });

      showToast(`Status atualizado para "${nextStatus}"`);
      addHistoryLog(
        `Atualizou pré-cadastro de ${reg.nomePaciente} para ${nextStatus}`,
        'Pré-cadastro',
        regId,
        prevStatus,
        nextStatus
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'registration_status');
    }
  };

  // --- AUDITORIA DE HISTÓRICO DE AÇÕES ---
  const addHistoryLog = async (acao: string, entidade: string, entidadeId: string, statusAnterior: string | null, statusNovo: string | null) => {
    if (!user) return;
    const newLogId = `log-${Date.now()}`;
    const newLog = {
      id: newLogId,
      administradorId: loggedAdmin || 'coordenador',
      administradorNome: loggedAdmin || 'coordenador',
      acao,
      entidade,
      entidadeId,
      statusAnterior,
      statusNovo,
      dataHora: new Date().toISOString().replace('T', ' ').substring(0, 16)
    };
    try {
      await setDoc(doc(db, 'history', newLogId), newLog);
    } catch (err) {
      console.warn("Could not save history log:", err);
    }
  };

  // --- DISPARO DE LINK DIRETO PARA O WHATSAPP ---
  const handleWhatsAppContact = (reg: any) => {
    const formattedDate = new Date(reg.data + 'T00:00:00').toLocaleDateString('pt-BR');
    const text = `Olá, ${reg.nomePaciente}. Tudo bem? Recebemos sua solicitação para atendimento de ultrassonografia na Gesttus no dia ${formattedDate}, às ${reg.horario}. Estamos entrando em contato para confirmar sua presença.`;
    const cleanPhone = reg.whatsappPaciente.replace(/\D/g, '');
    const url = `https://api.whatsapp.com/send?phone=55${cleanPhone}&text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
    addHistoryLog(`Abriu contato de WhatsApp com ${reg.nomePaciente}`, 'Pré-cadastro', reg.id, reg.status, reg.status);
  };

  // --- UPLOAD DE LOGOTIPO PERSONALIZADO EM BASE64 ---
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 1024 * 1024) {
      showToast("O arquivo deve ter no máximo 1MB de tamanho.", "error");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64String = reader.result as string;
      try {
        await setDoc(doc(db, 'settings', 'branding'), {
          logoBase64: base64String,
          updatedAt: new Date().toISOString()
        });
        showToast("Logotipo da empresa atualizado com sucesso!");
        addHistoryLog("Atualizou o logotipo institucional da marca", "Configuração", "branding", null, "LogoAtualizado");
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'settings/branding');
        showToast("Erro ao processar e salvar imagem.", "error");
      }
    };
    reader.readAsDataURL(file);
  };

  // --- FORMATAÇÕES DE AUXÍLIO ---
  const formatFriendlyDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    const options: any = { weekday: 'long', day: 'numeric', month: 'long' };
    return date.toLocaleDateString('pt-BR', options);
  };

  // --- MÉTRICAS GERAIS DO DASHBOARD ---
  const metrics = {
    totalClasses: classes.length,
    totalSlots: slots.length,
    availableSlots: slots.filter(s => s.status === 'Disponível').length,
    pendingRegs: registrations.filter(r => r.status === 'Pré-cadastrada').length,
    confirmedRegs: registrations.filter(r => r.status === 'Confirmada').length,
    attendedRegs: registrations.filter(r => r.status === 'Atendida').length,
    absentRegs: registrations.filter(r => r.status === 'Não compareceu').length
  };

  // Filtros em memória (RULE 2)
  const filteredRegistrations = registrations.filter(reg => {
    const matchExam = filterExam === 'Todos' || reg.tipoExameId === filterExam;
    const matchStatus = filterStatus === 'Todos' || reg.status === filterStatus;
    const matchSearch = reg.nomePaciente.toLowerCase().includes(searchPatient.toLowerCase()) || 
                        reg.whatsappPaciente.includes(searchPatient);
    return matchExam && matchStatus && matchSearch;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 rounded-full border-4 border-zinc-100 border-t-zinc-900 animate-spin" />
        <p className="text-zinc-500 font-bold text-sm tracking-widest uppercase">Conectando ao Firestore...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-800 selection:bg-zinc-200">
      
      {/* HEADER DE MARCA - Dinâmico com suporte a Logotipo Base64 carregado */}
      <header className="bg-white border-b border-zinc-100 sticky top-0 z-40 px-4 py-4 shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {brandingLogo ? (
              <img 
                src={brandingLogo} 
                alt="Logo Gesttus" 
                className="w-12 h-12 object-contain rounded-lg border border-zinc-100"
              />
            ) : (
              <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center text-white font-black text-xl tracking-tight">
                G
              </div>
            )}
            <div>
              <h1 className="text-lg font-extrabold tracking-tight text-zinc-950">GESTTUS</h1>
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest -mt-1">Pós-Graduação em Ultrassonografia</p>
            </div>
          </div>
          
          {/* Menu Paciente Logado */}
          {!isAdminMode && loggedPatient && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-500 hidden sm:inline">Olá, <strong className="text-zinc-800">{loggedPatient.primeiroNome}</strong></span>
              <button 
                onClick={() => setCurrentView('my_requests')}
                className="text-xs text-zinc-700 bg-zinc-100 hover:bg-zinc-200 px-3 py-2 rounded-lg font-medium transition-all"
              >
                Minhas Solicitações
              </button>
              <button 
                onClick={() => {
                  setLoggedPatient(null);
                  setCurrentView('welcome');
                  showToast('Logoff realizado.');
                }}
                className="text-xs text-zinc-400 hover:text-zinc-800 transition-all font-semibold"
              >
                Sair
              </button>
            </div>
          )}

          {/* Menu Admin Logado */}
          {isAdminMode && loggedAdmin && (
            <div className="flex items-center gap-4">
              <span className="text-xs bg-zinc-100 px-2.5 py-1.5 rounded-md border border-zinc-100 text-zinc-700 font-bold font-mono">
                {loggedAdmin}
              </span>
              <button 
                onClick={handleAdminLogout}
                className="text-xs text-zinc-500 hover:text-zinc-950 flex items-center gap-1 transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                Sair
              </button>
            </div>
          )}
        </div>
      </header>

      {/* NOTIFICAÇÃO TOAST */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-bounce">
          <div className={`rounded-xl px-5 py-4 shadow-xl border flex items-center gap-3 max-w-sm ${
            toast.type === 'error' 
              ? 'bg-zinc-900 text-white border-zinc-900' 
              : 'bg-white text-zinc-800 border-zinc-100'
          }`}>
            <div className={`w-2 h-2 rounded-full ${toast.type === 'error' ? 'bg-red-500' : 'bg-zinc-900'}`} />
            <p className="text-sm font-semibold">{toast.message}</p>
          </div>
        </div>
      )}

      {/* CORPO DO APLICATIVO */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        
        {/* ==================== FLUXO DO PACIENTE ==================== */}
        {!isAdminMode && (
          <div className="max-w-md mx-auto">
            
            {/* TELA 1: BEM-VINDO */}
            {currentView === 'welcome' && (
              <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-8 text-center space-y-8 animate-fadeIn">
                <div className="w-20 h-20 bg-zinc-100 rounded-2xl mx-auto flex items-center justify-center text-zinc-800">
                  {brandingLogo ? (
                    <img src={brandingLogo} alt="Logo" className="w-full h-full object-contain rounded-2xl" />
                  ) : (
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 13.5a3 3 0 100-6 3 3 0 000 6z" /></svg>
                  )}
                </div>
                
                <div className="space-y-3">
                  <h2 className="text-2xl font-black text-zinc-950 tracking-tight">Pré-cadastro para Ultrassonografia</h2>
                  <p className="text-zinc-500 text-sm leading-relaxed">
                    Escolha um exame médico prático disponível e solicite o agendamento de forma simplificada.
                  </p>
                </div>

                <div className="bg-zinc-50 rounded-2xl p-5 border border-zinc-100 text-left space-y-2">
                  <span className="text-[10px] uppercase font-extrabold tracking-widest text-zinc-400">Como funciona?</span>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Sua solicitação de vaga será recebida e analisada pela nossa equipe médica acadêmica. A confirmação oficial será enviada para o seu WhatsApp.
                  </p>
                </div>

                <button 
                  onClick={() => {
                    setLoginTab('paciente');
                    setCurrentView('login');
                  }}
                  className="w-full bg-zinc-900 hover:bg-zinc-800 text-white font-bold py-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300"
                >
                  Iniciar pré-cadastro
                </button>

                <p className="text-[11px] text-zinc-400 font-medium">Gesttus Pós-graduação em Ultrassonografia</p>
              </div>
            )}

            {/* TELA 2: LOGIN CONSOLIDADO (PACIENTE E COLABORADOR) */}
            {currentView === 'login' && (
              <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-8 space-y-6 animate-fadeIn">
                <div className="flex border-b border-zinc-100">
                  <button
                    onClick={() => setLoginTab('paciente')}
                    className={`flex-1 pb-3 text-sm font-bold text-center transition-all ${
                      loginTab === 'paciente' ? 'border-b-2 border-zinc-900 text-zinc-950' : 'text-zinc-400 hover:text-zinc-500'
                    }`}
                  >
                    Identificação do Paciente
                  </button>
                  <button
                    onClick={() => setLoginTab('colaborador')}
                    className={`flex-1 pb-3 text-sm font-bold text-center transition-all ${
                      loginTab === 'colaborador' ? 'border-b-2 border-zinc-900 text-zinc-950' : 'text-zinc-400 hover:text-zinc-500'
                    }`}
                  >
                    Área da Equipe
                  </button>
                </div>

                {/* LOGIN PACIENTE */}
                {loginTab === 'paciente' && (
                  <form onSubmit={handlePatientLogin} className="space-y-4">
                    <p className="text-zinc-500 text-xs text-center">Informe seus dados para ver exames ou consultar status.</p>
                    <div>
                      <label className="block text-xs font-bold text-zinc-600 uppercase mb-1.5">Primeiro Nome</label>
                      <input 
                        type="text" 
                        placeholder="Ex: João" 
                        value={patientForm.primeiroNome}
                        onChange={e => setPatientForm({ ...patientForm, primeiroNome: e.target.value })}
                        className="w-full bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3.5 text-zinc-700 focus:outline-none text-sm"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-600 uppercase mb-1.5">WhatsApp / Celular</label>
                      <input 
                        type="tel" 
                        placeholder="(00) 00000-0000" 
                        value={patientForm.whatsapp}
                        onChange={e => setPatientForm({ ...patientForm, whatsapp: e.target.value })}
                        className="w-full bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3.5 text-zinc-700 focus:outline-none text-sm"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-600 uppercase mb-1.5">Data de Nascimento</label>
                      <input 
                        type="date" 
                        value={patientForm.dataNascimento}
                        onChange={e => setPatientForm({ ...patientForm, dataNascimento: e.target.value })}
                        className="w-full bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3.5 text-zinc-700 focus:outline-none text-sm"
                        required
                      />
                    </div>

                    <button 
                      type="submit"
                      className="w-full bg-zinc-900 hover:bg-zinc-800 text-white font-bold py-4 rounded-2xl shadow-md"
                    >
                      Continuar como Paciente
                    </button>
                  </form>
                )}

                {/* LOGIN ADMINISTRADOR */}
                {loginTab === 'colaborador' && (
                  <form onSubmit={handleAdminLogin} className="space-y-4">
                    <p className="text-zinc-500 text-xs text-center">Acesso restrito para docentes, equipe de atendimento e coordenação.</p>
                    
                    <div>
                      <label className="block text-xs font-bold text-zinc-600 uppercase mb-1.5">Usuário de Acesso</label>
                      <input 
                        type="text" 
                        placeholder="Nome de usuário do colaborador" 
                        value={adminLoginForm.usuario}
                        onChange={e => setAdminLoginForm({ ...adminLoginForm, usuario: e.target.value })}
                        className="w-full bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3.5 text-zinc-700 focus:outline-none text-sm"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-600 uppercase mb-1.5">Senha de Acesso</label>
                      <input 
                        type="password" 
                        placeholder="••••••••" 
                        value={adminLoginForm.senha}
                        onChange={e => setAdminLoginForm({ ...adminLoginForm, senha: e.target.value })}
                        className="w-full bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3.5 text-zinc-700 focus:outline-none text-sm"
                        required
                      />
                    </div>

                    <button 
                      type="submit"
                      className="w-full bg-zinc-900 hover:bg-zinc-800 text-white font-bold py-4 rounded-2xl shadow-md"
                    >
                      Entrar no Painel Clínico
                    </button>
                  </form>
                )}

                <div className="border-t border-zinc-100 pt-4 text-center">
                  <button onClick={() => setCurrentView('welcome')} className="text-xs text-zinc-400 hover:text-zinc-800 font-bold">
                    ← Voltar à Tela Inicial
                  </button>
                </div>
              </div>
            )}

            {/* TELA 3: LISTA DE EXAMES */}
            {currentView === 'exams' && (
              <div className="space-y-6 animate-fadeIn">
                <div className="space-y-1">
                  <span className="text-xs text-zinc-500 font-semibold">Olá, {loggedPatient?.primeiroNome}</span>
                  <h2 className="text-2xl font-black text-zinc-950 tracking-tight">Selecione o Exame</h2>
                </div>

                <div className="space-y-4">
                  {exams.filter(e => e.ativo).map(exam => {
                    const totalSlotsCount = slots.filter(s => s.tipoExameId === exam.id && s.status === 'Disponível').length;

                    return (
                      <div 
                        key={exam.id} 
                        className="bg-white rounded-2xl border border-zinc-100 p-5 shadow-sm space-y-4 hover:border-zinc-300 transition-all"
                      >
                        <div className="space-y-1.5">
                          <h3 className="font-extrabold text-lg text-zinc-950">{exam.nome}</h3>
                          <p className="text-xs text-zinc-500 leading-relaxed">{exam.descricao}</p>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-zinc-100">
                          <span className="text-xs font-bold text-zinc-500 bg-zinc-100 px-2.5 py-1 rounded-md">
                            {totalSlotsCount} {totalSlotsCount === 1 ? 'vaga' : 'vagas'} em aberto
                          </span>
                          
                          <button 
                            onClick={() => {
                              if (totalSlotsCount === 0) {
                                showToast('Não há vagas disponíveis para este procedimento no momento.', 'error');
                                return;
                              }
                              setSelectedExam(exam);
                              setCurrentView('dates');
                            }}
                            disabled={totalSlotsCount === 0}
                            className={`text-xs font-bold px-4 py-2.5 rounded-xl transition-all ${
                              totalSlotsCount > 0 
                                ? 'bg-zinc-900 text-white hover:bg-zinc-800' 
                                : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                            }`}
                          >
                            Ver datas
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TELA 4: SELEÇÃO DE DATA */}
            {currentView === 'dates' && selectedExam && (
              <div className="space-y-6 animate-fadeIn">
                <div className="flex items-center gap-2">
                  <button onClick={() => setCurrentView('exams')} className="p-1.5 bg-white border border-zinc-100 rounded-lg text-zinc-600 hover:bg-zinc-100">
                    ←
                  </button>
                  <div>
                    <span className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider">Passo 2 de 4</span>
                    <h2 className="text-lg font-extrabold text-zinc-950 leading-tight">{selectedExam.nome}</h2>
                  </div>
                </div>

                <div className="space-y-3">
                  {classes
                    .filter(c => c.tipoExameId === selectedExam.id && c.status === 'Ativa')
                    .map(cls => {
                      const availableSlots = slots.filter(s => s.aulaId === cls.id && s.status === 'Disponível');
                      
                      return (
                        <button
                          key={cls.id}
                          onClick={() => {
                            setSelectedClass(cls);
                            setCurrentView('slots');
                          }}
                          className="w-full text-left bg-white border border-zinc-100 rounded-2xl p-5 hover:border-zinc-900 transition-all shadow-sm space-y-3"
                        >
                          <div>
                            <span className="text-[10px] font-extrabold text-zinc-400 uppercase block mb-1">AULA PRÁTICA</span>
                            <h4 className="font-extrabold text-zinc-950 text-base">{formatFriendlyDate(cls.data)}</h4>
                          </div>
                          <div className="flex items-center justify-between w-full pt-2 border-t border-zinc-100">
                            <span className="text-xs text-zinc-500 font-medium">Janela: {cls.horarioInicio} às {cls.horarioFim}</span>
                            <span className="text-xs font-bold text-zinc-800 bg-zinc-100 px-2.5 py-1 rounded-md">
                              {availableSlots.length} vagas livres
                            </span>
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}

            {/* TELA 5: SELEÇÃO DE HORÁRIOS */}
            {currentView === 'slots' && selectedClass && (
              <div className="space-y-6 animate-fadeIn">
                <div className="flex items-center gap-2">
                  <button onClick={() => setCurrentView('dates')} className="p-1.5 bg-white border border-zinc-100 rounded-lg text-zinc-600">
                    ←
                  </button>
                  <div>
                    <span className="text-[10px] font-extrabold text-zinc-400 uppercase">Passo 3 de 4</span>
                    <h2 className="text-lg font-extrabold text-zinc-950 leading-tight">Escolha o horário</h2>
                  </div>
                </div>

                <div className="bg-white border border-zinc-100 rounded-2xl p-4 space-y-2 text-xs text-zinc-500">
                  <p><strong>Exame:</strong> {selectedExam.nome}</p>
                  <p><strong>Data:</strong> {formatFriendlyDate(selectedClass.data)}</p>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {slots
                    .filter(s => s.aulaId === selectedClass.id)
                    .map(slot => {
                      const isSelected = selectedSlot?.id === slot.id;
                      const isOccupied = slot.status !== 'Disponível';

                      return (
                        <button
                          key={slot.id}
                          onClick={() => { if (!isOccupied) setSelectedSlot(slot); }}
                          disabled={isOccupied}
                          className={`py-3.5 px-2 text-center rounded-xl font-bold text-xs transition-all border ${
                            isSelected 
                              ? 'bg-zinc-900 text-white border-zinc-900' 
                              : isOccupied 
                                ? 'bg-zinc-100 text-zinc-300 border-zinc-100 cursor-not-allowed' 
                                : 'bg-white text-zinc-700 border-zinc-100 hover:border-zinc-900'
                          }`}
                        >
                          {slot.horario}
                        </button>
                      );
                    })}
                </div>

                <button
                  onClick={() => {
                    if (!selectedSlot) {
                      showToast('Por favor, selecione um horário para continuar.', 'error');
                      return;
                    }
                    setCurrentView('confirm');
                  }}
                  className="w-full bg-zinc-900 hover:bg-zinc-800 text-white font-bold py-4 rounded-2xl"
                >
                  Confirmar e continuar
                </button>
              </div>
            )}

            {/* TELA 6: CONFIRMAÇÃO DO PRÉ-CADASTRO */}
            {currentView === 'confirm' && selectedSlot && (
              <div className="bg-white rounded-2xl border border-zinc-100 p-8 space-y-6 animate-fadeIn">
                <div className="space-y-1 text-center">
                  <span className="text-[10px] font-extrabold text-zinc-400 uppercase">Confirmação Final</span>
                  <h2 className="text-2xl font-black text-zinc-950">Revise seus dados</h2>
                </div>

                <div className="space-y-4 pt-4">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Nome Completo</label>
                    <input 
                      type="text" 
                      value={patientFullName}
                      placeholder="Nome completo do paciente"
                      onChange={e => setPatientFullName(e.target.value)}
                      className="w-full bg-zinc-50 border border-zinc-100 rounded-lg px-3 py-2 text-zinc-700 font-bold focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4 border-b border-zinc-100 pb-3">
                    <div>
                      <span className="block text-[10px] font-bold text-zinc-400 uppercase mb-0.5">WhatsApp</span>
                      <span className="text-zinc-700 font-bold text-sm">{loggedPatient?.whatsapp}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] font-bold text-zinc-400 uppercase mb-0.5">Nascimento</span>
                      <span className="text-zinc-700 font-bold text-sm">
                        {loggedPatient?.dataNascimento ? new Date(loggedPatient.dataNascimento + 'T00:00:00').toLocaleDateString('pt-BR') : ''}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3 bg-zinc-50 rounded-2xl p-4 border border-zinc-100">
                    <div>
                      <span className="block text-[9px] font-bold text-zinc-400 uppercase">Procedimento solicitado</span>
                      <span className="text-zinc-700 font-extrabold text-base block mt-0.5">{selectedExam.nome}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-100">
                      <div>
                        <span className="block text-[9px] font-bold text-zinc-400 uppercase">Data</span>
                        <span className="text-zinc-700 font-bold text-xs">{formatFriendlyDate(selectedSlot.data)}</span>
                      </div>
                      <div>
                        <span className="block text-[9px] font-bold text-zinc-400 uppercase">Horário</span>
                        <span className="text-zinc-700 font-bold text-xs">{selectedSlot.horario}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-4">
                  <button onClick={handleConfirmPreRegistration} className="w-full bg-zinc-900 hover:bg-zinc-800 text-white font-bold py-4 rounded-2xl text-center">
                    Enviar solicitação
                  </button>
                  <button onClick={() => setCurrentView('slots')} className="w-full text-zinc-500 hover:text-zinc-950 font-bold text-xs py-2">
                    Voltar e alterar horário
                  </button>
                </div>
              </div>
            )}

            {/* TELA 7: SUCESSO */}
            {currentView === 'success' && selectedSlot && (
              <div className="bg-white rounded-2xl border border-zinc-100 p-8 text-center space-y-6 animate-fadeIn">
                <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center text-zinc-800 mx-auto">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                </div>

                <div className="space-y-2">
                  <h2 className="text-2xl font-black text-zinc-950">Solicitação Recebida!</h2>
                  <p className="text-zinc-500 text-sm">Nossa equipe entrará em contato via WhatsApp para confirmar sua vaga.</p>
                </div>

                <div className="bg-zinc-50 rounded-2xl p-4 border border-zinc-100 text-left space-y-2 text-xs">
                  <p><strong>Exame:</strong> {selectedExam.nome}</p>
                  <p><strong>Data:</strong> {formatFriendlyDate(selectedSlot.data)}</p>
                  <p><strong>Horário:</strong> {selectedSlot.horario}</p>
                  <p><strong>Status:</strong> <span className="bg-zinc-200 text-zinc-700 px-2 py-0.5 rounded font-bold uppercase text-[9px]">Aguardando Confirmação</span></p>
                </div>

                <button onClick={() => setCurrentView('my_requests')} className="w-full bg-zinc-900 hover:bg-zinc-800 text-white font-bold py-3.5 rounded-2xl">
                  Ver minhas solicitações
                </button>
              </div>
            )}

            {/* TELA 8: MINHAS SOLICITAÇÕES */}
            {currentView === 'my_requests' && (
              <div className="space-y-6 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-black text-zinc-950 tracking-tight">Minhas Solicitações</h2>
                  <button onClick={() => setCurrentView('exams')} className="text-xs font-bold text-zinc-700 bg-white border border-zinc-100 px-3 py-2 rounded-xl">
                    Nova solicitação +
                  </button>
                </div>

                <div className="space-y-3">
                  {registrations.filter(r => r.whatsappPaciente === loggedPatient?.whatsapp).length === 0 ? (
                    <div className="bg-white rounded-2xl border border-zinc-100 p-6 text-center text-zinc-400">
                      Nenhuma solicitação em seu WhatsApp.
                    </div>
                  ) : (
                    registrations
                      .filter(r => r.whatsappPaciente === loggedPatient?.whatsapp)
                      .map(reg => {
                        const ex = exams.find(e => e.id === reg.tipoExameId);
                        return (
                          <div key={reg.id} className="bg-white rounded-2xl border border-zinc-100 p-5 shadow-sm space-y-3">
                            <div className="flex justify-between items-center">
                              <h4 className="font-extrabold text-zinc-950 text-sm">{ex ? ex.nome : 'Ultrassonografia'}</h4>
                              <span className="text-[9px] uppercase tracking-wider font-extrabold px-2.5 py-1 rounded-md bg-zinc-100">
                                {reg.status}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs text-zinc-500">
                              <p><strong>Dia:</strong> {formatFriendlyDate(reg.data)}</p>
                              <p><strong>Horário:</strong> {reg.horario}</p>
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
            )}

          </div>
        )}

        {/* ==================== ÁREA ADMINISTRATIVA ==================== */}
        {isAdminMode && loggedAdmin && (
          <div className="space-y-8 animate-fadeIn">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
              
              {/* MENU NAVEGAÇÃO LATERAL */}
              <div className="lg:col-span-1 space-y-2">
                <div className="bg-zinc-950 rounded-2xl border border-zinc-800 p-4 shadow-sm space-y-1">
                  <button 
                    onClick={() => setCurrentView('admin_dashboard')}
                    className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold transition-all ${currentView === 'admin_dashboard' ? 'bg-zinc-900 text-white shadow-md' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
                  >
                    Dashboard
                  </button>
                  <button 
                    onClick={() => setCurrentView('admin_registrations')}
                    className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold transition-all ${currentView === 'admin_registrations' ? 'bg-zinc-900 text-white shadow-md' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
                  >
                    Inscrições ({metrics.pendingRegs})
                  </button>
                  <button 
                    onClick={() => setCurrentView('admin_classes')}
                    className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold transition-all ${currentView === 'admin_classes' ? 'bg-zinc-900 text-white shadow-md' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
                  >
                    Aulas Práticas
                  </button>
                  <button 
                    onClick={() => setCurrentView('admin_exams')}
                    className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold transition-all ${currentView === 'admin_exams' ? 'bg-zinc-900 text-white shadow-md' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
                  >
                    Tipos de Exame
                  </button>
                  <button 
                    onClick={() => setCurrentView('admin_reports')}
                    className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold transition-all ${currentView === 'admin_reports' ? 'bg-zinc-900 text-white shadow-md' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
                  >
                    Relatórios Clínicos
                  </button>
                  <button 
                    onClick={() => setCurrentView('admin_config')}
                    className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold transition-all ${currentView === 'admin_config' ? 'bg-zinc-900 text-white shadow-md' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
                  >
                    Identidade & Logo
                  </button>
                  <button 
                    onClick={() => setCurrentView('admin_logs')}
                    className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold transition-all ${currentView === 'admin_logs' ? 'bg-zinc-900 text-white shadow-md' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
                  >
                    Log de Auditoria
                  </button>
                </div>
              </div>

              {/* PAINEL DE CONTEÚDO */}
              <div className="lg:col-span-3 space-y-6">
                
                {/* DASHBOARD */}
                {currentView === 'admin_dashboard' && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h2 className="text-2xl font-black text-zinc-950">Painel Executivo</h2>
                      <button onClick={() => setCurrentView('admin_new_class')} className="bg-zinc-900 text-white text-xs font-bold px-4 py-2.5 rounded-xl">
                        + Criar Nova Aula
                      </button>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div className="bg-white border border-zinc-100 p-5 rounded-2xl">
                        <span className="text-[10px] font-extrabold text-zinc-400 uppercase block">Aulas Ativas</span>
                        <p className="text-2xl font-extrabold text-zinc-950 mt-1">{metrics.totalClasses}</p>
                      </div>
                      <div className="bg-white border border-zinc-100 p-5 rounded-2xl">
                        <span className="text-[10px] font-extrabold text-zinc-400 uppercase block">Inscrições Pendentes</span>
                        <p className="text-2xl font-extrabold text-zinc-950 mt-1">{metrics.pendingRegs}</p>
                      </div>
                      <div className="bg-white border border-zinc-100 p-5 rounded-2xl">
                        <span className="text-[10px] font-extrabold text-zinc-400 uppercase block">Confirmados</span>
                        <p className="text-2xl font-extrabold text-zinc-950 mt-1">{metrics.confirmedRegs}</p>
                      </div>
                    </div>

                    {/* SOLICITAÇÕES RECENTES */}
                    <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-4">
                      <h3 className="font-extrabold text-base border-b border-zinc-100 pb-3">Últimas Solicitações de Pacientes</h3>
                      <div className="space-y-3">
                        {registrations.slice(0, 4).map(reg => (
                          <div key={reg.id} className="flex justify-between items-center p-4 bg-zinc-50 border border-zinc-100 rounded-xl">
                            <div>
                              <h4 className="font-bold text-sm text-zinc-800">{reg.nomePaciente}</h4>
                              <p className="text-xs text-zinc-500">{reg.whatsappPaciente} | {reg.horario}</p>
                            </div>
                            <span className="text-xs uppercase font-bold tracking-wider px-2.5 py-1 rounded bg-zinc-200">
                              {reg.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* CONTROLE DE INSCRIÇÕES */}
                {currentView === 'admin_registrations' && (
                  <div className="space-y-6">
                    <h2 className="text-2xl font-black">Controle de Inscrições</h2>
                    
                    {/* FILTROS */}
                    <div className="bg-white border border-zinc-100 p-4 rounded-2xl flex flex-wrap gap-3 items-center justify-between">
                      <div className="flex gap-2">
                        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-zinc-50 border border-zinc-100 rounded-lg text-xs px-2.5 py-1.5 focus:outline-none">
                          <option value="Todos">Todos os Status</option>
                          <option value="Pré-cadastrada">Pendentes</option>
                          <option value="Confirmada">Confirmados</option>
                          <option value="Atendida">Atendidos</option>
                          <option value="Cancelada">Cancelados</option>
                        </select>
                      </div>
                      <input 
                        type="text" 
                        placeholder="Buscar paciente..." 
                        value={searchPatient}
                        onChange={e => setSearchPatient(e.target.value)}
                        className="bg-zinc-50 border border-zinc-100 rounded-lg text-xs px-3 py-1.5 focus:outline-none w-48"
                      />
                    </div>

                    {/* TABELA */}
                    <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden overflow-x-auto">
                      <table className="w-full text-left text-xs min-w-max">
                        <thead>
                          <tr className="bg-zinc-50 border-b border-zinc-100 text-zinc-500 uppercase font-black text-[9px] tracking-wider">
                            <th className="p-4">Paciente</th>
                            <th className="p-4">WhatsApp</th>
                            <th className="p-4">Data / Hora</th>
                            <th className="p-4">Status</th>
                            <th className="p-4 text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200">
                          {filteredRegistrations.map(reg => (
                            <tr key={reg.id} className="hover:bg-zinc-50">
                              <td className="p-4 font-bold">{reg.nomePaciente}</td>
                              <td className="p-4 font-mono">{reg.whatsappPaciente}</td>
                              <td className="p-4">{reg.data} às {reg.horario}</td>
                              <td className="p-4">
                                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-200">
                                  {reg.status}
                                </span>
                              </td>
                              <td className="p-4 text-right space-x-1.5">
                                {reg.status === 'Pré-cadastrada' && (
                                  <button onClick={() => handleUpdateRegistrationStatus(reg.id, 'Confirmada')} className="bg-emerald-600 text-white px-2 py-1 rounded font-bold hover:bg-emerald-700">
                                    Confirmar
                                  </button>
                                )}
                                {reg.status === 'Confirmada' && (
                                  <>
                                    <button onClick={() => handleUpdateRegistrationStatus(reg.id, 'Atendida')} className="bg-zinc-900 text-white px-2 py-1 rounded font-bold hover:bg-zinc-800">
                                      Atendido
                                    </button>
                                    <button onClick={() => handleUpdateRegistrationStatus(reg.id, 'Não compareceu')} className="bg-red-600 text-white px-2 py-1 rounded font-bold hover:bg-red-700">
                                      Faltou
                                    </button>
                                  </>
                                )}
                                <button onClick={() => handleWhatsAppContact(reg)} className="bg-zinc-100 text-zinc-800 border border-zinc-300 px-2.5 py-1 rounded hover:bg-zinc-200">
                                  WhatsApp 💬
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* AULAS PRÁTICAS */}
                {currentView === 'admin_classes' && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h2 className="text-2xl font-black">Aulas Práticas</h2>
                      <button onClick={() => setCurrentView('admin_new_class')} className="bg-zinc-900 text-white text-xs font-bold px-4 py-2.5 rounded-xl">
                        + Nova Aula
                      </button>
                    </div>

                    <div className="space-y-4">
                      {classes.map(cls => (
                        <div key={cls.id} className="bg-white border border-zinc-100 rounded-2xl p-5 space-y-3">
                          <div className="flex justify-between items-start">
                            <div>
                              <span className="text-[9px] uppercase tracking-wider text-zinc-400 font-bold">{cls.tipoExameNome}</span>
                              <h3 className="text-lg font-extrabold text-zinc-950">{cls.nome}</h3>
                              <p className="text-xs text-zinc-500">Data: {cls.data} | Janela: {cls.horarioInicio} às {cls.horarioFim}</p>
                            </div>
                            <span className="text-xs font-extrabold bg-zinc-50 px-2.5 py-1 rounded border border-zinc-100">{cls.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* NOVA AULA */}
                {currentView === 'admin_new_class' && (
                  <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-6">
                    <h2 className="text-xl font-extrabold">Criar Nova Aula Prática</h2>
                    
                    <form onSubmit={handleCreateClass} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-zinc-600 uppercase mb-1">Nome da Turma / Aula</label>
                          <input type="text" placeholder="Ex: Ginecologia Prática - Turma B" value={newClassForm.nome} onChange={e => setNewClassForm({ ...newClassForm, nome: e.target.value })} className="w-full bg-zinc-50 border border-zinc-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-zinc-500" required />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-zinc-600 uppercase mb-1">Tipo de Exame</label>
                          <select value={newClassForm.tipoExameId} onChange={e => setNewClassForm({ ...newClassForm, tipoExameId: e.target.value })} className="w-full bg-zinc-50 border border-zinc-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-zinc-500" required>
                            <option value="">Selecione...</option>
                            {exams.map(ex => (
                              <option key={ex.id} value={ex.id}>{ex.nome}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-zinc-600 uppercase mb-1">Data</label>
                          <input type="date" value={newClassForm.data} onChange={e => setNewClassForm({ ...newClassForm, data: e.target.value })} className="w-full bg-zinc-50 border border-zinc-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-zinc-500" required />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-zinc-600 uppercase mb-1">Início</label>
                          <input type="time" value={newClassForm.horarioInicio} onChange={e => setNewClassForm({ ...newClassForm, horarioInicio: e.target.value })} className="w-full bg-zinc-50 border border-zinc-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-zinc-500" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-zinc-600 uppercase mb-1">Término</label>
                          <input type="time" value={newClassForm.horarioFim} onChange={e => setNewClassForm({ ...newClassForm, horarioFim: e.target.value })} className="w-full bg-zinc-50 border border-zinc-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-zinc-500" />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4 border-t border-zinc-100 pt-4">
                        <div>
                          <label className="block text-xs font-bold text-zinc-600 uppercase mb-1">Almoço Início</label>
                          <input type="time" value={newClassForm.intervaloAlmocoInicio} onChange={e => setNewClassForm({ ...newClassForm, intervaloAlmocoInicio: e.target.value })} className="w-full bg-zinc-50 border border-zinc-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-zinc-500" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-zinc-600 uppercase mb-1">Almoço Fim</label>
                          <input type="time" value={newClassForm.intervaloAlmocoFim} onChange={e => setNewClassForm({ ...newClassForm, intervaloAlmocoFim: e.target.value })} className="w-full bg-zinc-50 border border-zinc-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-zinc-500" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-zinc-600 uppercase mb-1">Vagas</label>
                          <input type="number" value={newClassForm.quantidadeVagas} onChange={e => setNewClassForm({ ...newClassForm, quantidadeVagas: Number(e.target.value) })} className="w-full bg-zinc-50 border border-zinc-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-zinc-500" min="1" max="40" />
                        </div>
                      </div>

                      <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100">
                        <button type="button" onClick={() => setCurrentView('admin_classes')} className="text-zinc-500 hover:text-zinc-700 font-bold text-xs px-4">Cancelar</button>
                        <button type="submit" className="bg-zinc-900 text-white hover:bg-zinc-800 text-xs font-bold px-6 py-3 rounded-xl">Criar Aula e Vagas</button>
                      </div>
                    </form>
                  </div>
                )}

                {/* TIPOS DE EXAME */}
                {currentView === 'admin_exams' && (
                  <div className="space-y-6">
                    <h2 className="text-2xl font-black">Especialidades Clínicas</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="md:col-span-1 bg-white border border-zinc-100 rounded-2xl p-5 space-y-4">
                        <h3 className="font-extrabold text-sm uppercase">Novo Tipo de Exame</h3>
                        <form onSubmit={handleCreateExam} className="space-y-3">
                          <div>
                            <label className="block text-xs font-bold mb-1">Nome</label>
                            <input type="text" placeholder="Ex: Doppler Arterial" value={newExamForm.nome} onChange={e => setNewExamForm({ ...newExamForm, nome: e.target.value })} className="w-full bg-zinc-50 border border-zinc-100 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-zinc-900" required />
                          </div>
                          <div>
                            <label className="block text-xs font-bold mb-1">Descrição</label>
                            <textarea placeholder="Indicações clínicas..." value={newExamForm.descricao} onChange={e => setNewExamForm({ ...newExamForm, descricao: e.target.value })} className="w-full bg-zinc-50 border border-zinc-100 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-zinc-900 h-20" />
                          </div>
                          <button type="submit" className="w-full bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-xs py-2.5 rounded-xl">Adicionar</button>
                        </form>
                      </div>
                      <div className="md:col-span-2 space-y-2">
                        {exams.map(ex => (
                          <div key={ex.id} className="bg-white border border-zinc-100 p-4 rounded-xl flex justify-between items-center">
                            <div>
                              <h4 className="font-extrabold text-zinc-950 text-sm">{ex.nome}</h4>
                              <p className="text-xs text-zinc-500">{ex.descricao}</p>
                            </div>
                            <span className="text-[10px] bg-zinc-100 border border-zinc-100 px-2 py-1 rounded">Catálogo Ativo</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* RELATÓRIOS */}
                {currentView === 'admin_reports' && (
                  <div className="space-y-6 animate-fadeIn">
                    <h2 className="text-2xl font-black">Relatórios Clínicos</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="bg-white border border-zinc-100 rounded-2xl p-5 space-y-4">
                        <h3 className="font-extrabold text-sm border-b border-zinc-100 pb-2">Preenchimento de Procedimentos</h3>
                        <div className="space-y-3">
                          {exams.map(ex => {
                            const examSlots = slots.filter(s => s.tipoExameId === ex.id);
                            const total = examSlots.length;
                            const occupied = examSlots.filter(s => s.status !== 'Disponível').length;
                            const percentage = total > 0 ? Math.round((occupied / total) * 100) : 0;

                            return (
                              <div key={ex.id} className="space-y-1 text-xs">
                                <div className="flex justify-between font-bold">
                                  <span className="truncate pr-2">{ex.nome}</span>
                                  <span>{occupied}/{total} ({percentage}%)</span>
                                </div>
                                <div className="w-full bg-zinc-100 h-2 rounded-full overflow-hidden">
                                  <div className="bg-zinc-900 h-full transition-all duration-500" style={{ width: `${percentage}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="bg-white border border-zinc-100 rounded-2xl p-5 space-y-4">
                        <h3 className="font-extrabold text-sm border-b border-zinc-100 pb-2">Índices de Presença</h3>
                        <div className="grid grid-cols-2 gap-4 text-center">
                          <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-100">
                            <span className="text-[10px] font-extrabold text-zinc-400 uppercase">Aproveitamento</span>
                            <p className="text-2xl font-black mt-1">
                              {metrics.totalSlots > 0 ? Math.round(((metrics.totalSlots - metrics.availableSlots) / metrics.totalSlots) * 100) : 0}%
                            </p>
                          </div>
                          <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-100">
                            <span className="text-[10px] font-extrabold text-zinc-400 uppercase">Absenteísmo</span>
                            <p className="text-2xl font-black mt-1">
                              {metrics.attendedRegs + metrics.absentRegs > 0 ? Math.round((metrics.absentRegs / (metrics.attendedRegs + metrics.absentRegs)) * 100) : 0}%
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* CONFIGURAÇÃO DE IDENTIDADE VISUAL */}
                {currentView === 'admin_config' && (
                  <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-6">
                    <div>
                      <h2 className="text-xl font-extrabold">Configurações de Marca & Identidade</h2>
                      <p className="text-xs text-zinc-500">Suba o logotipo da instituição. Esta imagem substituirá instantaneamente os placeholders de todos os pacientes em tempo real.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center border-t border-zinc-100 pt-6">
                      <div className="space-y-4">
                        <label className="block text-xs font-bold text-zinc-600 uppercase tracking-wider">Carregar Novo Logotipo (PNG/JPG - Máx 1MB)</label>
                        <input 
                          type="file" 
                          accept="image/*" 
                          onChange={handleLogoUpload}
                          className="w-full text-xs text-zinc-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-zinc-900 file:text-white hover:file:bg-zinc-800 cursor-pointer"
                        />
                      </div>

                      <div className="bg-zinc-50 rounded-2xl p-6 border border-zinc-100 flex flex-col items-center justify-center space-y-2">
                        <span className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest">Visualização Atual da Logo</span>
                        {brandingLogo ? (
                          <div className="space-y-2 text-center">
                            <img src={brandingLogo} alt="Logo Cadastrada" className="w-24 h-24 object-contain rounded-xl border bg-white p-2 mx-auto" />
                            <button 
                              onClick={async () => {
                                try {
                                  await setDoc(doc(db, 'settings', 'branding'), { logoBase64: '' });
                                  showToast("Logo institucional redefinida para o padrão.");
                                } catch (err) {
                                  handleFirestoreError(err, OperationType.WRITE, 'settings/branding');
                                }
                              }}
                              className="text-xs text-red-600 font-bold hover:underline"
                            >
                              Remover Logo
                            </button>
                          </div>
                        ) : (
                          <div className="w-20 h-20 bg-zinc-200 rounded-xl flex items-center justify-center font-bold text-zinc-500 text-3xl">G</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* REGISTRO DE AUDITORIA */}
                {currentView === 'admin_logs' && (
                  <div className="space-y-6">
                    <h2 className="text-2xl font-black">Registro de Auditoria / Logs</h2>
                    <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden">
                      <div className="divide-y divide-zinc-200">
                        {historyLogs.length === 0 ? (
                           <div className="p-4 text-center text-zinc-500 text-xs">Nenhum evento registrado.</div>
                        ) : (
                           historyLogs.map(log => (
                            <div key={log.id} className="p-4 flex justify-between text-xs">
                              <div className="space-y-1">
                                <span className="bg-zinc-200 text-zinc-700 font-bold px-1.5 py-0.5 rounded text-[10px]">{log.administradorNome}</span>
                                <p className="text-zinc-800 font-semibold">{log.acao}</p>
                                <p className="text-[10px] text-zinc-400">Entidade: {log.entidade} #{log.entidadeId}</p>
                              </div>
                              <span className="text-[10px] text-zinc-400 font-medium whitespace-nowrap ml-4">{log.dataHora}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}

              </div>

            </div>
          </div>
        )}

      </main>

      {/* RODAPÉ */}
      <footer className="bg-zinc-900 text-zinc-500 py-10 mt-16 text-xs text-center border-t border-zinc-900">
        <p className="font-black text-white tracking-wider text-sm uppercase">GESTTUS ULTRASSONOGRAFIA</p>
        <p className="max-w-md mx-auto text-zinc-400 leading-relaxed pt-2">
          Plataforma dedicada de pré-cadastro de exames para fins acadêmicos. Agendamento sujeito a confirmação via WhatsApp pela secretaria.
        </p>
        <p className="text-zinc-500 pt-3">© 2026 Gesttus Ensino Médico LTDA. Todos os direitos reservados.</p>
      </footer>

    </div>
  );
}
