module.exports = {
  content: ['./admin-app/index.html', './pos-app/index.html', './admin-app/js/*.js', './pos-app/js/*.js'],
  theme: {
    extend: {
      colors: {
        midnight:       '#1B261F',
        'midnight-card':'#243329',
        crema:          '#1F2D24',
        'crema-dark':   '#141E18',
        roast:          '#6A543B',
        barista:        '#8A9A8C',
        espresso:       '#7A5543',
        foam:           '#EAECE9',
        'text-dark':    '#141E18',
        'text-light':   '#F9FAFB',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        body:    ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono:    ['JetBrains Mono', 'monospace'],
      },
    }
  }
};
