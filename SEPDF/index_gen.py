import os

f = os.popen("ls");
file_list = f.read().split("\n");

print '''
<!-- Here you can add your Google Analytics Tracking code. If you do so, do not
forget to set the include_analytics attribute to true on the _config.yml file -->
<script>
  (function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){
  (i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),
  m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)
  })(window,document,'script','//www.google-analytics.com/analytics.js','ga');

  ga('create', 'UA-68639768-1', 'auto');
  ga('send', 'pageview');

</script>
'''

for one_file in file_list:
  print '<p><a href="http://andi.ac/SEPDF/'+one_file+'">'+one_file+'</a></p>'
