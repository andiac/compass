var endtype = function() {
  $(".typed-cursor").hide();
};

var tagline2 = function() {
  $(".tagline2").typed({
                      strings: ["University of Cambridge"],
                      typeSpeed: 10,
                      backDelay: 0,
                      startDelay: 700,
                      loop: false,
                      loopCount: 1,
                      cursorChar: "|",
                      callback: endtype
                    });
};

var tagline = function() {
  $(".typed-cursor").hide();
  $(".content").delay(800).fadeIn(2000);
  $(".tagline").typed({
                      strings: ["PhD Student"],
                      typeSpeed: 10,
                      backDelay: 0,
                      startDelay: 700,
                      loop: false,
                      loopCount: 1,
                      cursorChar: "|",
                      callback: tagline2
                    });
};

var name2 = function() {
  $(".typed-cursor").hide();
  $(".author-name2").typed({
                      strings: ["&nbsp;Zhang"],
                      typeSpeed: 0,
                      backDelay: 0,
                      startDelay: 250,
                      loop: false,
                      loopCount: 1,
                      cursorChar: "|",
                      callback: tagline
                    });
};

var name1 = function() {
  $(".author-name").typed({
                    strings: ["Andi"],
                    typeSpeed: 0,
                    backDelay: 0,
                    startDelay: 400,
                    loop: false,
                    loopCount: 1,
                    cursorChar: "|",
                    callback: name2
                  });
};

$(window).load(function() {
  $(".logo-container").delay(500).fadeIn(1000, name1);
});

