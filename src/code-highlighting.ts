import Prism from 'prismjs';
import 'prismjs/components/prism-bash.js';
import 'prismjs/components/prism-python.js';
import 'prismjs/components/prism-docker.js';
import 'prismjs/components/prism-nginx.js';
import 'prismjs/components/prism-yaml.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-go.js';
import 'prismjs/components/prism-sql.js';
import 'prismjs/components/prism-ini.js';
import 'prismjs/components/prism-toml.js';

// Common fence spellings, including names copied from configuration files.
Prism.languages.Dockerfile = Prism.languages.docker;
Prism.languages.Python = Prism.languages.python;
Prism.languages.Nginx = Prism.languages.nginx;
Prism.languages.Bash = Prism.languages.bash;
Prism.languages.conf = Prism.languages.ini;

export { Prism };
export function highlightCode(code: string, language: string) {
  const grammar = Object.hasOwn(Prism.languages, language) ? Prism.languages[language] : undefined;
  return grammar && typeof grammar === 'object' ? Prism.highlight(code, grammar, language) : code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
