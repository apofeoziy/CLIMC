#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { program } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const ora = require('ora');

// Конфигурация
const PLUGINS_FILE = 'pl.txt';
const PLUGINS_DIR = 'plugins';
const SERVER_JAR = 'server.jar';
const PAPER_DOWNLOAD_URL = 'https://mcutils.com/api/server-jars/purpur/1.21.4/download';
const MODRINTH_API_URL = 'https://api.modrinth.com/v2';

// Утилиты для вывода
const log = {
  info: (msg) => console.log(chalk.blue('ℹ ') + msg),
  success: (msg) => console.log(chalk.green('✓ ') + msg),
  warn: (msg) => console.log(chalk.yellow('⚠ ') + msg),
  error: (msg) => console.log(chalk.red('✗ ') + msg)
};

// Проверка наличия ядра сервера
async function checkServerJar() {
  if (!fs.existsSync(SERVER_JAR)) {
    log.warn('Ядро сервера (server.jar) не найдено');
    
    const { download } = await inquirer.prompt([{
      type: 'confirm',
      name: 'download',
      message: 'Хотите скачать ядро сервера Paper?',
      default: true
    }]);
    
    if (download) {
      await downloadPaperServerJar();
    } else {
      log.info('Продолжаем без скачивания ядра сервера');
    }
  } else {
    log.success('Ядро сервера найдено');
  }
}

// Скачивание последней версии PaperMC
async function downloadPaperServerJar() {
  try {
    const spinner = ora('Получение информации о последней версии Paper...').start();
    
    // Получаем список версий
    const versionsResponse = await axios.get(PAPER_DOWNLOAD_URL);
    const latestVersion = versionsResponse.data.versions[versionsResponse.data.versions.length - 1];
    
    spinner.text = `Получение информации о сборках для версии ${latestVersion}...`;
    
    // Получаем список сборок для последней версии
    const buildsResponse = await axios.get(`${PAPER_DOWNLOAD_URL}/versions/${latestVersion}`);
    const latestBuild = buildsResponse.data.builds[buildsResponse.data.builds.length - 1];
    
    spinner.text = `Скачивание Paper ${latestVersion} (сборка ${latestBuild})...`;
    
    // Скачиваем сервер
    const downloadUrl = `${PAPER_DOWNLOAD_URL}/versions/${latestVersion}/builds/${latestBuild}/downloads/paper-${latestVersion}-${latestBuild}.jar`;
    const response = await axios({
      method: 'get',
      url: downloadUrl,
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(SERVER_JAR);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        spinner.succeed(`Paper ${latestVersion} (сборка ${latestBuild}) успешно скачан`);
        resolve();
      });
      writer.on('error', (err) => {
        spinner.fail('Ошибка при скачивании ядра сервера');
        reject(err);
      });
    });
  } catch (error) {
    log.error(`Ошибка при скачивании ядра сервера: ${error.message}`);
    throw error;
  }
}

// Парсинг файла плагинов
function parsePluginsFile() {
  if (!fs.existsSync(PLUGINS_FILE)) {
    log.warn(`Файл ${PLUGINS_FILE} не найден. Создаем пустой файл.`);
    fs.writeFileSync(PLUGINS_FILE, '# Minecraft Plugins List\n# Формат: имя_плагина|версия|ссылка_на_скачивание\n\n');
    return [];
  }

  const content = fs.readFileSync(PLUGINS_FILE, 'utf8');
  const plugins = [];

  content.split('\n').forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const parts = line.split('|');
      if (parts.length >= 3) {
        plugins.push({
          name: parts[0].trim(),
          version: parts[1].trim(),
          url: parts[2].trim(),
          source: parts.length >= 4 ? parts[3].trim() : 'direct'
        });
      }
    }
  });

  return plugins;
}

// Скачивание плагинов
async function downloadPlugins() {
  const plugins = parsePluginsFile();
  
  if (plugins.length === 0) {
    log.warn('Нет плагинов для скачивания');
    return;
  }

  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR);
  }

  log.info(`Найдено ${plugins.length} плагинов для установки/обновления`);

  for (const plugin of plugins) {
    const fileName = `${plugin.name}-${plugin.version}.jar`;
    const filePath = path.join(PLUGINS_DIR, fileName);

    // Проверяем существует ли уже этот плагин
    if (fs.existsSync(filePath)) {
      log.info(`Плагин ${plugin.name} v${plugin.version} уже установлен`);
      continue;
    }

    const spinner = ora(`Скачивание ${plugin.name} v${plugin.version}...`).start();
    
    try {
      let downloadUrl = plugin.url;
      
      // Если это Modrinth плагин с ID вместо прямой ссылки
      if (plugin.source === 'modrinth' && !plugin.url.startsWith('http')) {
        const modrinthData = await getModrinthDownloadUrl(plugin.url, plugin.version);
        downloadUrl = modrinthData.downloadUrl;
        spinner.text = `Скачивание ${plugin.name} v${modrinthData.version} с Modrinth...`;
      }
      
      const response = await axios({
        method: 'get',
        url: downloadUrl,
        responseType: 'stream'
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      spinner.succeed(`Плагин ${plugin.name} v${plugin.version} успешно скачан`);
    } catch (error) {
      spinner.fail(`Ошибка при скачивании плагина ${plugin.name}: ${error.message}`);
    }
  }
}

// Вывод списка плагинов
function listPlugins() {
  const plugins = parsePluginsFile();
  
  if (plugins.length === 0) {
    log.warn('Нет плагинов в файле pl.txt');
    return;
  }

  log.info('Список плагинов:');
  plugins.forEach((plugin, index) => {
    const source = plugin.source === 'modrinth' ? chalk.magenta('[Modrinth]') : '';
    console.log(`${index + 1}. ${chalk.cyan(plugin.name)} v${plugin.version} ${source}`);
  });
}

// Проверка статуса плагинов
function checkPluginsStatus() {
  const plugins = parsePluginsFile();
  
  if (plugins.length === 0) {
    log.warn('Нет плагинов в файле pl.txt');
    return;
  }

  if (!fs.existsSync(PLUGINS_DIR)) {
    log.warn('Директория plugins не существует');
    return;
  }

  log.info('Статус плагинов:');
  
  plugins.forEach((plugin) => {
    const fileName = `${plugin.name}-${plugin.version}.jar`;
    const filePath = path.join(PLUGINS_DIR, fileName);
    const source = plugin.source === 'modrinth' ? chalk.magenta('[Modrinth]') : '';
    
    if (fs.existsSync(filePath)) {
      console.log(`${chalk.green('✓')} ${chalk.cyan(plugin.name)} v${plugin.version} ${source} - установлен`);
    } else {
      console.log(`${chalk.red('✗')} ${chalk.cyan(plugin.name)} v${plugin.version} ${source} - не установлен`);
    }
  });
}

// Добавление нового плагина
async function addPlugin() {
  const { source } = await inquirer.prompt([{
    type: 'list',
    name: 'source',
    message: 'Выберите источник плагина:',
    choices: [
      { name: 'Прямая ссылка на JAR файл', value: 'direct' },
      { name: 'Modrinth', value: 'modrinth' }
    ]
  }]);

  if (source === 'direct') {
    await addDirectPlugin();
  } else if (source === 'modrinth') {
    await addModrinthPlugin();
  }
}

// Добавление плагина по прямой ссылке
async function addDirectPlugin() {
  const { name, version, url } = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Введите название плагина:',
      validate: (input) => input.trim() !== '' ? true : 'Название плагина не может быть пустым'
    },
    {
      type: 'input',
      name: 'version',
      message: 'Введите версию плагина:',
      validate: (input) => input.trim() !== '' ? true : 'Версия не может быть пустой'
    },
    {
      type: 'input',
      name: 'url',
      message: 'Введите URL для скачивания:',
      validate: (input) => {
        if (input.trim() === '') return 'URL не может быть пустым';
        if (!input.startsWith('http')) return 'URL должен начинаться с http:// или https://';
        return true;
      }
    }
  ]);

  const pluginLine = `${name}|${version}|${url}|direct`;
  
  if (!fs.existsSync(PLUGINS_FILE)) {
    fs.writeFileSync(PLUGINS_FILE, '# Minecraft Plugins List\n# Формат: имя_плагина|версия|ссылка_на_скачивание\n\n');
  }
  
  fs.appendFileSync(PLUGINS_FILE, `${pluginLine}\n`);
  log.success(`Плагин ${name} v${version} добавлен в список`);
  
  const { download } = await inquirer.prompt([{
    type: 'confirm',
    name: 'download',
    message: 'Хотите скачать этот плагин сейчас?',
    default: true
  }]);
  
  if (download) {
    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR);
    }

    const fileName = `${name}-${version}.jar`;
    const filePath = path.join(PLUGINS_DIR, fileName);
    const spinner = ora(`Скачивание ${name} v${version}...`).start();
    
    try {
      const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream'
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      spinner.succeed(`Плагин ${name} v${version} успешно скачан`);
    } catch (error) {
      spinner.fail(`Ошибка при скачивании плагина ${name}: ${error.message}`);
    }
  }
}

// Поиск плагина на Modrinth
async function searchModrinthPlugins(query, mcVersion = null, limit = 10) {
  try {
    const facets = [["project_type:plugin"]];
    
    // Добавляем фильтр по версии Minecraft, если она указана
    if (mcVersion) {
      facets.push([`versions:${mcVersion}`]);
    }
    
    const response = await axios.get(`${MODRINTH_API_URL}/search`, {
      params: {
        query,
        limit,
        facets: JSON.stringify(facets)
      }
    });
    
    return response.data.hits.map(plugin => ({
      id: plugin.project_id,
      slug: plugin.slug,
      title: plugin.title,
      description: plugin.description,
      downloads: plugin.downloads,
      author: plugin.author
    }));
  } catch (error) {
    log.error(`Ошибка при поиске плагинов на Modrinth: ${error.message}`);
    return [];
  }
}

// Получение версий плагина с Modrinth
async function getModrinthVersions(projectId) {
  try {
    const response = await axios.get(`${MODRINTH_API_URL}/project/${projectId}/version`);
    return response.data.map(version => ({
      id: version.id,
      name: version.name,
      versionNumber: version.version_number,
      gameVersions: version.game_versions.join(', '),
      datePublished: new Date(version.date_published).toLocaleDateString(),
      downloads: version.downloads
    }));
  } catch (error) {
    log.error(`Ошибка при получении версий с Modrinth: ${error.message}`);
    return [];
  }
}

// Получение URL для скачивания с Modrinth
async function getModrinthDownloadUrl(projectId, versionId) {
  try {
    // Если versionId это "latest", получаем последнюю версию
    if (versionId === 'latest') {
      const versions = await getModrinthVersions(projectId);
      if (versions.length === 0) {
        throw new Error('Не найдены версии плагина');
      }
      
      versionId = versions[0].id;
    }
    
    // Получаем информацию о конкретной версии
    const response = await axios.get(`${MODRINTH_API_URL}/version/${versionId}`);
    
    if (!response.data || !response.data.files || response.data.files.length === 0) {
      throw new Error('Файлы для скачивания не найдены');
    }
    
    // Находим основной файл (обычно первый в списке или с primary=true)
    const primaryFile = response.data.files.find(file => file.primary) || response.data.files[0];
    
    return {
      downloadUrl: primaryFile.url,
      version: response.data.version_number
    };
  } catch (error) {
    throw new Error(`Ошибка при получении URL для скачивания: ${error.message}`);
  }
}

// Добавление плагина с Modrinth
async function addModrinthPlugin(initialQuery = '') {
  const { query } = await inquirer.prompt([{
    type: 'input',
    name: 'query',
    message: 'Введите название плагина для поиска:',
    default: initialQuery,
    validate: (input) => input.trim() !== '' ? true : 'Запрос не может быть пустым'
  }]);
  
  const { mcVersion } = await inquirer.prompt([{
    type: 'input',
    name: 'mcVersion',
    message: 'Введите версию Minecraft (опционально, например: 1.21.4):',
    default: '',
  }]);
  
  const spinner = ora('Поиск плагинов на Modrinth...').start();
  const plugins = await searchModrinthPlugins(query, mcVersion || null);
  spinner.stop();
  
  if (plugins.length === 0) {
    log.warn('Плагины не найдены');
    return;
  }
  
  const { pluginIndex } = await inquirer.prompt([{
    type: 'list',
    name: 'pluginIndex',
    message: 'Выберите плагин:',
    choices: plugins.map((plugin, index) => ({
      name: `${plugin.title} | ${plugin.description.substring(0, 50)}${plugin.description.length > 50 ? '...' : ''} | Загрузки: ${plugin.downloads}`,
      value: index
    }))
  }]);
  
  const selectedPlugin = plugins[pluginIndex];
  
  spinner.text = 'Получение доступных версий...';
  spinner.start();
  const versions = await getModrinthVersions(selectedPlugin.id);
  spinner.stop();
  
  if (versions.length === 0) {
    log.warn('Версии не найдены');
    return;
  }
  
  const { versionIndex } = await inquirer.prompt([{
    type: 'list',
    name: 'versionIndex',
    message: 'Выберите версию:',
    choices: versions.map((version, index) => ({
      name: `${version.name} (${version.versionNumber}) | MC: ${version.gameVersions} | Загрузки: ${version.downloads}`,
      value: index
    }))
  }]);
  
  const selectedVersion = versions[versionIndex];
  
  // Добавляем плагин в pl.txt
  const pluginLine = `${selectedPlugin.title}|${selectedVersion.versionNumber}|${selectedPlugin.id}|modrinth`;
  
  if (!fs.existsSync(PLUGINS_FILE)) {
    fs.writeFileSync(PLUGINS_FILE, '# Minecraft Plugins List\n# Формат: имя_плагина|версия|ссылка_на_скачивание|источник\n\n');
  }
  
  fs.appendFileSync(PLUGINS_FILE, `${pluginLine}\n`);
  log.success(`Плагин ${selectedPlugin.title} v${selectedVersion.versionNumber} добавлен в список`);
  
  const { download } = await inquirer.prompt([{
    type: 'confirm',
    name: 'download',
    message: 'Хотите скачать этот плагин сейчас?',
    default: true
  }]);
  
  if (download) {
    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR);
    }

    const fileName = `${selectedPlugin.title}-${selectedVersion.versionNumber}.jar`;
    const filePath = path.join(PLUGINS_DIR, fileName);
    
    spinner.text = `Скачивание ${selectedPlugin.title} v${selectedVersion.versionNumber}...`;
    spinner.start();
    
    try {
      const downloadInfo = await getModrinthDownloadUrl(selectedPlugin.id, selectedVersion.id);
      
      const response = await axios({
        method: 'get',
        url: downloadInfo.downloadUrl,
        responseType: 'stream'
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      spinner.succeed(`Плагин ${selectedPlugin.title} v${selectedVersion.versionNumber} успешно скачан`);
    } catch (error) {
      spinner.fail(`Ошибка при скачивании плагина ${selectedPlugin.title}: ${error.message}`);
    }
  }
}

// Удаление плагина
async function removePlugin() {
  const plugins = parsePluginsFile();
  
  if (plugins.length === 0) {
    log.warn('Нет плагинов для удаления');
    return;
  }

  const { pluginIndex } = await inquirer.prompt([{
    type: 'list',
    name: 'pluginIndex',
    message: 'Выберите плагин для удаления:',
    choices: plugins.map((plugin, index) => ({
      name: `${plugin.name} v${plugin.version} ${plugin.source === 'modrinth' ? '[Modrinth]' : ''}`,
      value: index
    }))
  }]);

  const plugin = plugins[pluginIndex];
  
  // Удаляем из файла pl.txt
  const content = fs.readFileSync(PLUGINS_FILE, 'utf8');
  const lines = content.split('\n');
  const newLines = lines.filter(line => {
    if (line.trim() && !line.startsWith('#')) {
      const parts = line.split('|');
      if (parts.length >= 3 && parts[0].trim() === plugin.name && parts[1].trim() === plugin.version) {
        return false;
      }
    }
    return true;
  });
  
  fs.writeFileSync(PLUGINS_FILE, newLines.join('\n'));
  log.success(`Плагин ${plugin.name} v${plugin.version} удален из списка`);
  
  // Удаляем файл плагина
  const fileName = `${plugin.name}-${plugin.version}.jar`;
  const filePath = path.join(PLUGINS_DIR, fileName);
  
  if (fs.existsSync(filePath)) {
    const { deleteFile } = await inquirer.prompt([{
      type: 'confirm',
      name: 'deleteFile',
      message: 'Удалить также файл плагина?',
      default: false
    }]);
    
    if (deleteFile) {
      fs.unlinkSync(filePath);
      log.success(`Файл плагина ${fileName} удален`);
    }
  }
}

// Прямой поиск плагинов Modrinth из CLI
async function searchModrinth(query, options) {
  const spinner = ora('Поиск плагинов на Modrinth...').start();
  const plugins = await searchModrinthPlugins(query, options.mcVersion, options.limit);
  spinner.stop();
  
  if (plugins.length === 0) {
    log.warn('Плагины не найдены');
    return;
  }
  
  log.info(`Результаты поиска для "${query}"${options.mcVersion ? ` (Minecraft ${options.mcVersion})` : ''}:`);
  plugins.forEach((plugin, index) => {
    console.log(`${index + 1}. ${chalk.cyan(plugin.title)}`);
    console.log(`   ${plugin.description.substring(0, 100)}${plugin.description.length > 100 ? '...' : ''}`);
    console.log(`   Автор: ${plugin.author} | Загрузки: ${plugin.downloads}`);
    console.log(`   ID: ${plugin.id}`);
    console.log('');
  });
  
  const { install } = await inquirer.prompt([{
    type: 'confirm',
    name: 'install',
    message: 'Хотите установить один из найденных плагинов?',
    default: false
  }]);
  
  if (install) {
    await addModrinthPlugin(query);
  }
}

// Обновление плагинов с Modrinth
async function updateModrinthPlugins() {
  const plugins = parsePluginsFile().filter(plugin => plugin.source === 'modrinth');
  
  if (plugins.length === 0) {
    log.warn('Нет плагинов Modrinth для обновления');
    return;
  }
  
  log.info(`Проверка обновлений для ${plugins.length} плагинов с Modrinth...`);
  
  for (const plugin of plugins) {
    const spinner = ora(`Проверка обновлений для ${plugin.name}...`).start();
    
    try {
      const versions = await getModrinthVersions(plugin.url);
      if (versions.length === 0) {
        spinner.fail(`Не удалось получить версии для ${plugin.name}`);
        continue;
      }
      
      const latestVersion = versions[0];
      
      if (latestVersion.versionNumber !== plugin.version) {
        spinner.info(`Доступно обновление для ${plugin.name}: ${plugin.version} -> ${latestVersion.versionNumber}`);
        
        const { update } = await inquirer.prompt([{
          type: 'confirm',
          name: 'update',
          message: `Обновить ${plugin.name} до v${latestVersion.versionNumber}?`,
          default: true
        }]);
        
        if (update) {
          // Обновляем запись в pl.txt
          const content = fs.readFileSync(PLUGINS_FILE, 'utf8');
          const lines = content.split('\n');
          const newLines = lines.map(line => {
            if (line.trim() && !line.startsWith('#')) {
              const parts = line.split('|');
              if (parts.length >= 4 && parts[0].trim() === plugin.name && parts[2].trim() === plugin.url && parts[3].trim() === 'modrinth') {
                return `${plugin.name}|${latestVersion.versionNumber}|${plugin.url}|modrinth`;
              }
            }
            return line;
          });
          
          fs.writeFileSync(PLUGINS_FILE, newLines.join('\n'));
          
          // Скачиваем новую версию
          spinner.text = `Скачивание ${plugin.name} v${latestVersion.versionNumber}...`;
          
          const downloadInfo = await getModrinthDownloadUrl(plugin.url, latestVersion.id);
          const fileName = `${plugin.name}-${latestVersion.versionNumber}.jar`;
          const filePath = path.join(PLUGINS_DIR, fileName);
          
          const response = await axios({
            method: 'get',
            url: downloadInfo.downloadUrl,
            responseType: 'stream'
          });
          
          const writer = fs.createWriteStream(filePath);
          response.data.pipe(writer);
          
          await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
          });
          
          // Удаляем старую версию
          const oldFileName = `${plugin.name}-${plugin.version}.jar`;
          const oldFilePath = path.join(PLUGINS_DIR, oldFileName);
          
          if (fs.existsSync(oldFilePath)) {
            fs.unlinkSync(oldFilePath);
          }
          
          spinner.succeed(`Плагин ${plugin.name} обновлен до v${latestVersion.versionNumber}`);
        } else {
          spinner.info(`Обновление ${plugin.name} пропущено`);
        }
      } else {
        spinner.succeed(`${plugin.name} v${plugin.version} уже последней версии`);
      }
    } catch (error) {
      spinner.fail(`Ошибка при проверке обновлений для ${plugin.name}: ${error.message}`);
    }
  }
}

// Функция для анализа директории и поиска плагинов по именам файлов
async function scanDirectoryForPlugins(directory = PLUGINS_DIR) {
  if (!fs.existsSync(directory)) {
    log.warn(`Директория ${directory} не существует`);
    return [];
  }

  const files = fs.readdirSync(directory);
  const pluginFiles = files.filter(file => file.toLowerCase().endsWith('.jar'));
  
  log.info(`Найдено ${pluginFiles.length} jar-файлов в директории ${directory}`);
  
  // Извлекаем предполагаемые имена плагинов из файлов
  const pluginNames = pluginFiles.map(file => {
    // Удаляем расширение .jar
    let name = file.slice(0, -4);
    
    // Удаляем версию (обычно выглядит как "-1.2.3")
    name = name.replace(/-\d+(\.\d+)*$/, '');
    
    // Преобразуем CamelCase в обычный текст для поиска
    name = name.replace(/([a-z])([A-Z])/g, '$1 $2');
    
    return name;
  });
  
  return { pluginFiles, pluginNames };
}

// Функция для автоматического поиска плагинов на Modrinth
async function autoScanAndSearch() {
  const spinner = ora('Сканирование директории плагинов...').start();
  const { pluginFiles, pluginNames } = await scanDirectoryForPlugins();
  
  if (pluginNames.length === 0) {
    spinner.fail('Плагины не найдены');
    return;
  }
  
  spinner.succeed(`Найдено ${pluginNames.length} возможных плагинов`);
  
  // Массив для хранения результатов поиска
  const searchResults = [];
  
  for (let i = 0; i < pluginNames.length; i++) {
    const name = pluginNames[i];
    const file = pluginFiles[i];
    
    const searchSpinner = ora(`Поиск плагина "${name}" на Modrinth...`).start();
    const results = await searchModrinthPlugins(name, null, 3);
    
    if (results.length > 0) {
      searchSpinner.succeed(`Найдены совпадения для "${name}"`);
      searchResults.push({
        fileName: file,
        searchName: name,
        modrinthResults: results
      });
    } else {
      searchSpinner.fail(`Не найдено совпадений для "${name}"`);
    }
  }
  
  if (searchResults.length === 0) {
    log.warn('Не удалось найти соответствия на Modrinth ни для одного плагина');
    return;
  }
  
  log.info(`Найдены соответствия для ${searchResults.length} плагинов:`);
  
  // Предлагаем пользователю выбрать плагины для добавления в pl.txt
  for (const result of searchResults) {
    console.log(`\nФайл: ${chalk.cyan(result.fileName)}`);
    console.log(`Поисковый запрос: ${result.searchName}`);
    console.log('Найденные плагины на Modrinth:');
    
    result.modrinthResults.forEach((plugin, index) => {
      console.log(`${index + 1}. ${chalk.cyan(plugin.title)}`);
      console.log(`   ${plugin.description.substring(0, 80)}${plugin.description.length > 80 ? '...' : ''}`);
    });
    
    const { addToList, pluginIndex } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'addToList',
        message: 'Добавить этот плагин в pl.txt?',
        default: true
      },
      {
        type: 'list',
        name: 'pluginIndex',
        message: 'Выберите правильный плагин:',
        choices: result.modrinthResults.map((plugin, index) => ({
          name: plugin.title,
          value: index
        })),
        when: answers => answers.addToList
      }
    ]);
    
    if (addToList) {
      const selectedPlugin = result.modrinthResults[pluginIndex];
      
      // Получаем версии плагина
      const versionsSpinner = ora(`Получение версий для ${selectedPlugin.title}...`).start();
      const versions = await getModrinthVersions(selectedPlugin.id);
      versionsSpinner.stop();
      
      if (versions.length === 0) {
        log.warn('Версии не найдены');
        continue;
      }
      
      const { versionIndex } = await inquirer.prompt([{
        type: 'list',
        name: 'versionIndex',
        message: 'Выберите версию:',
        choices: versions.map((version, index) => ({
          name: `${version.name} (${version.versionNumber}) | MC: ${version.gameVersions}`,
          value: index
        }))
      }]);
      
      const selectedVersion = versions[versionIndex];
      
      // Добавляем плагин в pl.txt
      const pluginLine = `${selectedPlugin.title}|${selectedVersion.versionNumber}|${selectedPlugin.id}|modrinth`;
      
      if (!fs.existsSync(PLUGINS_FILE)) {
        fs.writeFileSync(PLUGINS_FILE, '# Minecraft Plugins List\n# Формат: имя_плагина|версия|ссылка_на_скачивание|источник\n\n');
      }
      
      fs.appendFileSync(PLUGINS_FILE, `${pluginLine}\n`);
      log.success(`Плагин ${selectedPlugin.title} v${selectedVersion.versionNumber} добавлен в список`);
    }
  }
}

// Функция для автоматического сканирования и добавления плагинов в pl.txt
async function autoScanAndAddPlugins(autoConfirm = false) {
  const spinner = ora('Сканирование директории плагинов...').start();
  const { pluginFiles, pluginNames } = await scanDirectoryForPlugins();
  
  if (pluginNames.length === 0) {
    spinner.fail('Плагины не найдены');
    return;
  }
  
  spinner.succeed(`Найдено ${pluginNames.length} возможных плагинов`);
  
  // Массив для хранения результатов поиска
  const addedPlugins = [];
  const failedPlugins = [];
  
  for (let i = 0; i < pluginNames.length; i++) {
    const name = pluginNames[i];
    const file = pluginFiles[i];
    
    const searchSpinner = ora(`Поиск плагина "${name}" на Modrinth...`).start();
    const results = await searchModrinthPlugins(name, null, 1); // Ищем только 1 результат
    
    if (results.length > 0) {
      const plugin = results[0]; // Берём первый результат
      searchSpinner.succeed(`Найден плагин: ${plugin.title}`);
      
      try {
        // Получаем версии плагина
        const versions = await getModrinthVersions(plugin.id);
        
        if (versions.length === 0) {
          searchSpinner.fail(`Не найдены версии для плагина ${plugin.title}`);
          failedPlugins.push({ name, reason: 'Нет доступных версий' });
          continue;
        }
        
        // Берём первую (последнюю) версию
        const version = versions[0];
        
        // Добавляем плагин в pl.txt
        const pluginLine = `${plugin.title}|${version.versionNumber}|${plugin.id}|modrinth`;
        
        if (!fs.existsSync(PLUGINS_FILE)) {
          fs.writeFileSync(PLUGINS_FILE, '# Minecraft Plugins List\n# Формат: имя_плагина|версия|ссылка_на_скачивание|источник\n\n');
        }
        
        // Проверяем, не добавлен ли уже этот плагин
        const content = fs.readFileSync(PLUGINS_FILE, 'utf8');
        if (!content.includes(`${plugin.title}|`)) {
          fs.appendFileSync(PLUGINS_FILE, `${pluginLine}\n`);
          addedPlugins.push({ name: plugin.title, version: version.versionNumber });
          searchSpinner.succeed(`Плагин ${plugin.title} v${version.versionNumber} автоматически добавлен в список`);
        } else {
          searchSpinner.info(`Плагин ${plugin.title} уже существует в списке`);
        }
      } catch (error) {
        searchSpinner.fail(`Ошибка при добавлении плагина ${plugin.title}: ${error.message}`);
        failedPlugins.push({ name, reason: error.message });
      }
    } else {
      searchSpinner.fail(`Не найдено совпадений для "${name}"`);
      failedPlugins.push({ name, reason: 'Не найдено на Modrinth' });
    }
  }
  
  // Выводим итоговую статистику
  if (addedPlugins.length > 0) {
    log.success(`Автоматически добавлено ${addedPlugins.length} плагинов:`);
    addedPlugins.forEach(plugin => {
      console.log(`  - ${chalk.cyan(plugin.name)} v${plugin.version}`);
    });
  }
  
  if (failedPlugins.length > 0) {
    log.warn(`Не удалось добавить ${failedPlugins.length} плагинов:`);
    failedPlugins.forEach(plugin => {
      console.log(`  - ${chalk.yellow(plugin.name)}: ${plugin.reason}`);
    });
  }
  
  // Предлагаем скачать добавленные плагины
  if (addedPlugins.length > 0 && !autoConfirm) {
    const { download } = await inquirer.prompt([{
      type: 'confirm',
      name: 'download',
      message: 'Хотите скачать добавленные плагины сейчас?',
      default: true
    }]);
    
    if (download) {
      await downloadPlugins();
    }
  } else if (addedPlugins.length > 0 && autoConfirm) {
    // Если в автономном режиме, скачиваем плагины автоматически
    log.info('Автоматическое скачивание добавленных плагинов...');
    await downloadPlugins();
  }
}

// Главная функция
async function main() {
  program
    .name('server-manager')
    .description('Управление Minecraft сервером и плагинами')
    .version('1.0.0');

  program
    .command('check')
    .description('Проверить наличие ядра сервера и статус плагинов')
    .action(async () => {
      await checkServerJar();
      checkPluginsStatus();
    });

  program
    .command('download')
    .description('Скачать все плагины из списка')
    .action(async () => {
      await checkServerJar();
      await downloadPlugins();
    });

  program
    .command('list')
    .description('Показать список плагинов')
    .action(() => {
      listPlugins();
    });

  program
    .command('add [pluginName]')
    .description('Добавить новый плагин')
    .option('-m, --modrinth', 'Искать плагин на Modrinth', false)
    .option('-d, --direct', 'Использовать прямую ссылку', false)
    .action(async (pluginName, options) => {
      // Если указан только флаг modrinth, сразу переходим к поиску на Modrinth
      if (options.modrinth && pluginName) {
        await addModrinthPlugin(pluginName);
        return;
      }
      
      // Если указан только флаг direct, то загружаем через прямую ссылку
      if (options.direct) {
        await addDirectPlugin();
        return;
      }
      
      // Если указано название плагина, но без флага, предлагаем выбрать источник
      if (pluginName) {
        const { source } = await inquirer.prompt([{
          type: 'list',
          name: 'source',
          message: 'Выберите источник плагина:',
          choices: [
            { name: 'Modrinth', value: 'modrinth' },
            { name: 'Прямая ссылка на JAR файл', value: 'direct' }
          ]
        }]);
        
        if (source === 'modrinth') {
          await addModrinthPlugin(pluginName);
        } else {
          await addDirectPlugin();
        }
        return;
      }
      
      // Если ничего не указано, просто запускаем стандартный процесс
      await addPlugin();
    });

  program
    .command('remove')
    .description('Удалить плагин из списка')
    .action(async () => {
      await removePlugin();
    });

  program
    .command('update')
    .description('Обновить все плагины')
    .action(async () => {
      await downloadPlugins();
    });
  
  program
    .command('modrinth-search <query>')
    .alias('ms')
    .description('Поиск плагинов на Modrinth')
    .option('-v, --mc-version <version>', 'Указать версию Minecraft')
    .option('-l, --limit <number>', 'Ограничить количество результатов', parseInt, 10)
    .action(async (query, options) => {
      await searchModrinth(query, options);
    });
  
  program
    .command('modrinth-update')
    .alias('mu')
    .description('Проверить обновления плагинов с Modrinth')
    .action(async () => {
      await updateModrinthPlugins();
    });
  
  program
    .command('modrinth-add [query]')
    .alias('ma')
    .description('Добавить плагин с Modrinth')
    .option('-v, --mc-version <version>', 'Указать версию Minecraft')
    .action(async (query, options) => {
      if (query && options.mcVersion) {
        const plugins = await searchModrinthPlugins(query, options.mcVersion);
        if (plugins.length > 0) {
          // Если найден только один плагин, предлагаем его установить
          if (plugins.length === 1) {
            const plugin = plugins[0];
            log.info(`Найден плагин: ${plugin.title}`);
            
            const { install } = await inquirer.prompt([{
              type: 'confirm',
              name: 'install',
              message: `Установить плагин ${plugin.title}?`,
              default: true
            }]);
            
            if (install) {
              // Выводим информацию о плагине и начинаем процесс установки
              await addModrinthPlugin(query);
            }
          } else {
            // Если найдено несколько плагинов, переходим к стандартному процессу выбора
            await addModrinthPlugin(query);
          }
        } else {
          log.warn(`Плагины не найдены по запросу "${query}" для версии ${options.mcVersion}`);
        }
      } else {
        await addModrinthPlugin(query || '');
      }
    });

  program
    .command('scan')
    .alias('s')
    .description('Сканировать директорию и искать плагины на Modrinth')
    .option('-a, --auto', 'Автоматический режим без запросов', false)
    .action(async (options) => {
      if (options.auto) {
        await autoScanAndAddPlugins(true);
      } else {
        await autoScanAndSearch();
      }
    });

  program
    .command('auto-add')
    .alias('aa')
    .description('Автоматически добавить все найденные плагины без запросов')
    .action(async () => {
      await autoScanAndAddPlugins(true);
    });

  // Установка команды по умолчанию
  if (process.argv.length === 2) {
    process.argv.push('check');
  }

  program.parse(process.argv);
}

// Запуск программы
main().catch(err => {
  log.error(`Ошибка выполнения: ${err.message}`);
  process.exit(1);
}); 